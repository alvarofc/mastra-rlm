import { randomUUID } from 'node:crypto';

import { buildAudit } from './audit';
import { createControllerAdapter } from './controller';
import { ingestSources, ensureRunLayout, writeRunInput } from './ingestion';
import { RlmEventLogger } from './logger';
import { dirname, normalizePath } from './path-utils';
import { retrieveChunks } from './retrieval';
import { createScannerAdapter } from './scanner';
import type {
  ControllerAdapter,
  ControllerAction,
  ControllerContext,
  DraftOutput,
  NormalizedRlmConfig,
  RlmEvent,
  RlmRunInput,
  RlmRunResult,
  RlmRunnerOptions,
  VerifyOutput,
} from './types';
import { validateDraft } from './validation';

export class RlmRunner {
  private readonly options: RlmRunnerOptions;

  constructor(opts: RlmRunnerOptions) {
    this.options = opts;
  }

  async run(input: RlmRunInput): Promise<RlmRunResult> {
    const runId = randomUUID();
    const logger = await this.createLogger(runId);

    try {
      return await this.executeRun(runId, input, logger);
    } finally {
      logger.finish();
    }
  }

  async *runStreaming(input: RlmRunInput): AsyncGenerator<RlmEvent> {
    const runId = randomUUID();
    const logger = await this.createLogger(runId);

    const runPromise = this.executeRun(runId, input, logger).finally(() => {
      logger.finish();
    });

    for await (const event of logger.stream()) {
      yield event;
    }

    await runPromise;
  }

  private async executeRun(
    runId: string,
    input: RlmRunInput,
    logger: RlmEventLogger,
  ): Promise<RlmRunResult> {
    const workspace = this.options.workspace;
    const fs = workspace.filesystem;
    if (!fs) {
      throw new Error('Workspace filesystem is not configured');
    }

    const config = normalizeConfig(input);
    const controller =
      this.options.adapters?.controller ?? createControllerAdapter(this.options.controllerModel);
    const scanner = this.options.adapters?.scanner
      ? this.options.adapters.scanner
      : this.options.scannerModel
        ? createScannerAdapter(this.options.scannerModel.id)
        : undefined;

    await logger.emit({ type: 'run.start', runId, input });

    try {
      await ensureRunLayout(workspace, runId);
      await writeRunInput(workspace, runId, input);

      const ingestion = await ingestSources({
        workspace,
        runId,
        sources: input.sources,
        emit: event => logger.emit(event),
      });

      let iteration = 0;
      let depth = 0;
      let recentQueries: string[] = [];
      let retrievedChunks = ingestion.chunks;
      let draft: DraftOutput | null = null;
      let verify: VerifyOutput | null = null;
      let validationIssues: string[] = [];

      const outputPath = normalizePath(input.output.path);
      const auditPath = `/rlm/runs/${runId}/outputs/audit.json`;
      const draftPath = `/rlm/runs/${runId}/outputs/draft.md`;

      while (iteration < config.maxIterations) {
        await logger.emit({ type: 'iteration.start', iteration, depth });

        const context: ControllerContext = {
          input,
          iteration,
          depth,
          recentQueries,
          retrievedChunks,
          draft,
          verify,
        };

        const action = await this.decideAction(controller, context);
        await logger.emit({ type: 'controller.prompt', iteration, content: action });

        if (action.action === 'SEARCH') {
          const queries = action.queries.length > 0 ? action.queries : [input.task];
          recentQueries = queries;
          retrievedChunks = await retrieveChunks({
            workspace,
            runId,
            queries,
            topK: config.searchTopK,
          });
          await logger.emit({
            type: 'retrieval.result',
            iteration,
            chunks: retrievedChunks.map(chunk => ({
              chunkId: chunk.chunkId,
              docId: chunk.docId,
              sourcePath: chunk.sourcePath,
            })),
          });

          if (scanner && retrievedChunks.length > config.scannerBatchSize) {
            await logger.emit({
              type: 'scanner.prompt',
              iteration,
              content: {
                chunkCount: retrievedChunks.length,
                batchSize: config.scannerBatchSize,
              },
            });

            const hits = await scanner.scan({
              runId,
              iteration,
              task: input.task,
              queries,
              chunks: retrievedChunks,
              batchSize: config.scannerBatchSize,
              concurrency: config.scannerConcurrency,
            });

            if (hits.length > 0) {
              const selected = new Set(hits.map(hit => hit.chunkId));
              retrievedChunks = retrievedChunks.filter(chunk => selected.has(chunk.chunkId));
            }
          }
        } else if (action.action === 'SCAN') {
          if (scanner && retrievedChunks.length > 0) {
            await logger.emit({
              type: 'scanner.prompt',
              iteration,
              content: {
                chunkCount: retrievedChunks.length,
                focusQuestions: action.focusQuestions,
              },
            });

            const hits = await scanner.scan({
              runId,
              iteration,
              task: input.task,
              queries: action.focusQuestions,
              chunks: retrievedChunks,
              batchSize: config.scannerBatchSize,
              concurrency: config.scannerConcurrency,
            });

            if (hits.length > 0) {
              const selected = new Set(hits.map(hit => hit.chunkId));
              retrievedChunks = retrievedChunks.filter(chunk => selected.has(chunk.chunkId));
            }
          }
        } else if (action.action === 'DRAFT') {
          draft = await controller.draft(context);
          verify = null;
          await logger.emit({ type: 'draft.created', iteration, claims: draft.claims.length });

          const validation = validateDraft({
            draft,
            chunkById: ingestion.chunkById,
            requireQuotes: config.requireQuotes,
            allowInference: config.allowInference,
          });
          validationIssues = validation.issues.map(issue => `${issue.claimId}: ${issue.message}`);
        } else if (action.action === 'VERIFY') {
          if (!draft) {
            iteration += 1;
            continue;
          }

          verify = await controller.verify(context);
          const counts = countVerdicts(verify);

          await logger.emit({
            type: 'verify.result',
            iteration,
            supported: counts.supported,
            unsupported: counts.unsupported,
            contradicted: counts.contradicted,
          });

          if (verify.overall === 'NEEDS_MORE_EVIDENCE') {
            depth += 1;
            if (depth > config.maxDepth) {
              throw new Error(`Max depth exceeded (${config.maxDepth})`);
            }
          }

          if (verify.overall === 'CONTRADICTION' && config.contradictionPolicy === 'fail') {
            throw new Error('Contradiction detected and contradictionPolicy is set to fail');
          }
        } else if (action.action === 'REVISE') {
          if (!draft) {
            iteration += 1;
            continue;
          }

          draft = await controller.revise(context);
          verify = null;
          await logger.emit({
            type: 'revision.applied',
            iteration,
            notes: action.issues.join('; '),
          });

          const validation = validateDraft({
            draft,
            chunkById: ingestion.chunkById,
            requireQuotes: config.requireQuotes,
            allowInference: config.allowInference,
          });
          validationIssues = validation.issues.map(issue => `${issue.claimId}: ${issue.message}`);
        } else if (action.action === 'FINALIZE') {
          if (!draft) {
            throw new Error('Controller requested FINALIZE but no draft exists');
          }

          if (validationIssues.length > 0) {
            throw new Error(`Cannot finalize due to validation errors: ${validationIssues.join(' | ')}`);
          }

          const finalText = withMissingInfoFallback(draft.text, verify);
          await fs.writeFile(draftPath, finalText, { overwrite: true, recursive: true });

          const outputPayload =
            input.output.format === 'json'
              ? JSON.stringify({ text: finalText, claims: draft.claims }, null, 2)
              : finalText;

          await fs.mkdir(dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, outputPayload, { overwrite: true, recursive: true });

          const audit = buildAudit({
            runId,
            input,
            outputPath,
            draft,
            verify,
            iterations: iteration + 1,
            depth,
            chunksUsed: retrievedChunks.length,
          });
          await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), {
            overwrite: true,
            recursive: true,
          });

          await logger.emit({ type: 'run.final', outputPath, auditPath });
          return { outputPath, auditPath, runId };
        }

        iteration += 1;
      }

      throw new Error(`Max iterations exceeded (${config.maxIterations})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.emit({ type: 'run.error', error: message });
      throw error;
    }
  }

  private async createLogger(runId: string): Promise<RlmEventLogger> {
    const fs = this.options.workspace.filesystem;
    if (!fs) {
      throw new Error('Workspace filesystem is not configured');
    }

    const configuredPath = this.options.logger?.jsonlPath;
    const eventsPath = configuredPath
      ? normalizePath(configuredPath.replaceAll('{runId}', runId))
      : `/rlm/runs/${runId}/events.jsonl`;

    const logger = new RlmEventLogger(fs, eventsPath);
    await logger.init();
    return logger;
  }

  private async decideAction(controller: ControllerAdapter, context: ControllerContext): Promise<ControllerAction> {
    try {
      return await controller.decideNextAction(context);
    } catch {
      return fallbackAction(context);
    }
  }
}

function normalizeConfig(input: RlmRunInput): NormalizedRlmConfig {
  return {
    requireQuotes: input.grounding?.requireQuotes ?? true,
    allowInference: input.grounding?.allowInference ?? false,
    allowSynthesis: input.grounding?.allowSynthesis ?? true,
    maxDepth: input.budgets?.maxDepth ?? 5,
    maxIterations: input.budgets?.maxIterations ?? 200,
    scannerBatchSize: input.budgets?.scannerBatchSize ?? 20,
    scannerConcurrency: input.budgets?.scannerConcurrency ?? 4,
    searchTopK: input.budgets?.searchTopK ?? 1000,
    contradictionPolicy: input.contradictionPolicy ?? 'report',
    outputCitations: input.outputCitations ?? 'both',
  };
}

function fallbackAction(context: ControllerContext): ControllerAction {
  if (context.retrievedChunks.length === 0) {
    return {
      action: 'SEARCH',
      queries: [context.input.task],
      reasoning: 'No chunks are currently available.',
    };
  }

  if (!context.draft) {
    return {
      action: 'DRAFT',
      reasoning: 'A first grounded draft is required.',
    };
  }

  if (!context.verify) {
    return {
      action: 'VERIFY',
      reasoning: 'Verify claims before finalization.',
    };
  }

  if (context.verify.overall !== 'OK') {
    return {
      action: 'REVISE',
      issues: context.verify.verdicts
        .filter(verdict => verdict.status !== 'SUPPORTED')
        .map(verdict => `${verdict.claimId}: ${verdict.notes}`),
      reasoning: 'Verification detected unresolved issues.',
    };
  }

  return {
    action: 'FINALIZE',
    reasoning: 'Verification is OK.',
  };
}

function countVerdicts(verify: VerifyOutput): {
  supported: number;
  unsupported: number;
  contradicted: number;
} {
  let supported = 0;
  let unsupported = 0;
  let contradicted = 0;

  for (const verdict of verify.verdicts) {
    if (verdict.status === 'SUPPORTED') supported += 1;
    if (verdict.status === 'UNSUPPORTED' || verdict.status === 'AMBIGUOUS') unsupported += 1;
    if (verdict.status === 'CONTRADICTED') contradicted += 1;
  }

  return { supported, unsupported, contradicted };
}

function withMissingInfoFallback(text: string, verify: VerifyOutput | null): string {
  const supportedCount = (verify?.verdicts ?? []).filter(v => v.status === 'SUPPORTED').length;
  if (supportedCount > 0) return text;

  if (/not specified in the provided documents/i.test(text)) {
    return text;
  }

  const suffix = '\n\nNot specified in the provided documents.';
  return `${text.trim()}${suffix}`;
}
