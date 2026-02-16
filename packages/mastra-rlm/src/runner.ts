import { randomUUID } from 'node:crypto';

import { buildRunSummary } from './audit';
import { ingestSources, ensureRunLayout, writeRunInput } from './ingestion';
import { RlmEventLogger } from './logger';
import { createRootModelAdapter, createSubModelAdapter } from './models';
import { findFinalSignal, findReplCodeBlocks } from './parsing';
import { dirname, normalizePath } from './path-utils';
import {
  buildContextMetadataPrompt,
  buildExtractPrompt,
  buildIterationUserPrompt,
  buildSystemPrompt,
  formatReplResultForHistory,
} from './prompts';
import { initReplSession, readReplVariable, runReplCode } from './repl/executor';
import { SubqueryServer } from './subquery-server';
import type {
  ModelRef,
  NormalizedRlmConfig,
  RecursiveCallTrace,
  RlmEvent,
  RlmMessage,
  RlmRootModelAdapter,
  RlmRunInput,
  RlmRunResult,
  RlmRunnerOptions,
  RlmSubModelAdapter,
  RlmTrajectoryEntry,
  ReplVariableInfo,
} from './types';

const DEFAULT_ROOT_MODEL = process.env.RLM_AGENT_MODEL ?? 'openrouter/minimax/minimax-m2.5';

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

  private async executeRun(runId: string, input: RlmRunInput, logger: RlmEventLogger): Promise<RlmRunResult> {
    const workspace = this.options.workspace;
    const fs = workspace.filesystem;
    if (!fs) {
      throw new Error('Workspace filesystem is not configured');
    }

    const config = normalizeConfig(input);
    const sandboxAdapter = this.options.sandboxAdapter;
    const rootModel = this.resolveRootModel();
    const subModel = this.resolveSubModel(rootModel);
    const rootAdapter: RlmRootModelAdapter =
      this.options.adapters?.root ?? createRootModelAdapter(rootModel);
    const subAdapter: RlmSubModelAdapter = this.options.adapters?.sub ?? createSubModelAdapter(subModel);

    await logger.emit({ type: 'run.start', runId, input });
    const eventsPath = logger.path;

    try {
      await ensureRunLayout(workspace, runId);
      await writeRunInput(workspace, runId, input);

      const ingestion = await ingestSources({
        workspace,
        runId,
        sources: input.sources,
        emit: event => logger.emit(event),
      });

      const context = {
        ...ingestion.context,
        task: input.task,
      };
      const totalContextChars = context.documents.reduce((sum, document) => sum + document.content.length, 0);

      const replSession = await initReplSession({
        workspace,
        runId,
        context,
        sandboxAdapter,
      });

      const outputPath = normalizePath(input.output.path);
      const auditPath = `/rlm/runs/${runId}/outputs/audit.json`;
      const recursionPath = `/rlm/runs/${runId}/outputs/recursion-tree.json`;

      const messageHistory: RlmMessage[] = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'assistant', content: buildContextMetadataPrompt(context) },
      ];
      const trajectory: RlmTrajectoryEntry[] = [];
      let latestVariables: ReplVariableInfo[] = [
        {
          name: 'context',
          typeName: 'dict',
          totalLength: JSON.stringify(context).length,
          preview: '{"task": ..., "documents": [...]}',
        },
      ];

      const subqueryServer = new SubqueryServer({
        adapter: subAdapter,
        defaultModelId: subModel.id,
        maxCalls: config.maxCalls,
        maxDepth: config.maxDepth,
        emit: event => logger.emit(event),
      });
      await subqueryServer.start();

      try {
        for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
          await logger.emit({ type: 'iteration.start', iteration });

          const userPrompt = buildIterationUserPrompt({
            task: input.task,
            iteration,
            maxIterations: config.maxIterations,
            documentCount: context.documents.length,
            totalContextChars,
            maxCalls: config.maxCalls,
            callsUsed: subqueryServer.callsUsed,
            variables: latestVariables,
          });

          const messages = [...messageHistory, { role: 'user' as const, content: userPrompt }];

          await logger.emit({
            type: 'root.prompt',
            iteration,
            messageCount: messages.length,
          });

          const rootResponse = await rootAdapter.generate(messages);
          await logger.emit({
            type: 'root.response',
            iteration,
            text: truncate(rootResponse, 20_000),
          });

          messageHistory.push({ role: 'assistant', content: rootResponse });

          const codeBlocks = findReplCodeBlocks(rootResponse);
          for (let blockIndex = 0; blockIndex < codeBlocks.length; blockIndex += 1) {
            const code = codeBlocks[blockIndex] ?? '';
            await logger.emit({
              type: 'repl.code',
              iteration,
              blockIndex,
              code,
            });

            const execution = await runReplCode({
              workspace,
              session: replSession,
              code,
              llmEndpoint: subqueryServer.endpoint,
              depth: 1,
              iteration,
              sandboxAdapter,
            });

            const historyOutput = formatReplResultForHistory({
              code,
              stdout: execution.stdout,
              stderr: execution.stderr,
              maxOutputChars: config.maxOutputChars,
              variables: execution.variables,
              droppedVariables: execution.droppedVariables,
            });
            latestVariables = execution.variables;

            trajectory.push({
              iteration,
              code,
              output: historyOutput,
            });

            messageHistory.push({ role: 'user', content: historyOutput });

            await logger.emit({
              type: 'repl.result',
              iteration,
              blockIndex,
              stdout: truncate(execution.stdout, 5_000),
              stderr: truncate(execution.stderr, 5_000),
              variables: execution.variables.map(variable => variable.name),
              droppedVariables: execution.droppedVariables,
            });

            if (execution.finalSignal) {
              const finalOutput =
                execution.finalSignal.type === 'FINAL'
                  ? execution.finalSignal.answer
                  : await readReplVariable({
                      workspace,
                      session: replSession,
                      variableName: execution.finalSignal.varName,
                      sandboxAdapter,
                    });

              return this.finalizeRun({
                fs,
                logger,
                runId,
                outputPath,
                auditPath,
                recursionPath,
                input,
                outputText: finalOutput,
                config,
                context,
                trajectory,
                recursiveCalls: subqueryServer.recursionTrace,
                callsUsed: subqueryServer.callsUsed,
                eventsPath,
                iterations: iteration + 1,
                terminatedBy: execution.finalSignal.type,
              });
            }
          }

          const plainTextFinal = findFinalSignal(rootResponse);
          if (plainTextFinal) {
            messageHistory.push({
              role: 'user',
              content:
                'Do not finalize in plain text. Use REPL code and call FINAL(...) or FINAL_VAR(...) inside the code block.',
            });
          }
        }

        const fallbackPrompt = buildExtractPrompt(input.task, latestVariables);
        const fallbackResponse = await rootAdapter.generate([
          ...messageHistory,
          { role: 'user', content: fallbackPrompt },
        ]);

        const fallbackCodeBlocks = findReplCodeBlocks(fallbackResponse);
        for (let blockIndex = 0; blockIndex < fallbackCodeBlocks.length; blockIndex += 1) {
          const code = fallbackCodeBlocks[blockIndex] ?? '';

          await logger.emit({
            type: 'repl.code',
            iteration: config.maxIterations,
            blockIndex,
            code,
          });

          const execution = await runReplCode({
            workspace,
            session: replSession,
            code,
            llmEndpoint: subqueryServer.endpoint,
            depth: 1,
            iteration: config.maxIterations,
            sandboxAdapter,
          });

          const historyOutput = formatReplResultForHistory({
            code,
            stdout: execution.stdout,
            stderr: execution.stderr,
            maxOutputChars: config.maxOutputChars,
            variables: execution.variables,
            droppedVariables: execution.droppedVariables,
          });
          latestVariables = execution.variables;
          trajectory.push({
            iteration: config.maxIterations,
            code,
            output: historyOutput,
          });
          messageHistory.push({ role: 'user', content: historyOutput });

          await logger.emit({
            type: 'repl.result',
            iteration: config.maxIterations,
            blockIndex,
            stdout: truncate(execution.stdout, 5_000),
            stderr: truncate(execution.stderr, 5_000),
            variables: execution.variables.map(variable => variable.name),
            droppedVariables: execution.droppedVariables,
          });

          if (execution.finalSignal) {
            const finalOutput =
              execution.finalSignal.type === 'FINAL'
                ? execution.finalSignal.answer
                : await readReplVariable({
                    workspace,
                    session: replSession,
                    variableName: execution.finalSignal.varName,
                    sandboxAdapter,
                  });

            return this.finalizeRun({
              fs,
              logger,
              runId,
              outputPath,
              auditPath,
              recursionPath,
              input,
              outputText: finalOutput,
              config,
              context,
              trajectory,
              recursiveCalls: subqueryServer.recursionTrace,
              callsUsed: subqueryServer.callsUsed,
              eventsPath,
              iterations: config.maxIterations,
              terminatedBy: execution.finalSignal.type,
            });
          }
        }

        const fallbackSignal = findFinalSignal(fallbackResponse);
        let fallbackOutput = fallbackResponse;
        if (fallbackSignal?.type === 'FINAL') {
          fallbackOutput = fallbackSignal.answer;
        } else if (fallbackSignal?.type === 'FINAL_VAR') {
          const variableValue = await readReplVariable({
            workspace,
            session: replSession,
            variableName: fallbackSignal.varName,
            sandboxAdapter,
          });
          fallbackOutput = looksLikeMissingVariableError(variableValue) ? fallbackResponse : variableValue;
        }

        return this.finalizeRun({
          fs,
          logger,
          runId,
          outputPath,
          auditPath,
          recursionPath,
          input,
          outputText: fallbackOutput,
          config,
          context,
          trajectory,
          recursiveCalls: subqueryServer.recursionTrace,
          callsUsed: subqueryServer.callsUsed,
          eventsPath,
          iterations: config.maxIterations,
          terminatedBy: 'MAX_ITERATIONS',
        });
      } finally {
        await subqueryServer.stop();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.emit({ type: 'run.error', error: message });
      throw error;
    }
  }

  private async finalizeRun(params: {
    fs: NonNullable<RlmRunnerOptions['workspace']['filesystem']>;
    logger: RlmEventLogger;
    runId: string;
    outputPath: string;
    auditPath: string;
    recursionPath: string;
    input: RlmRunInput;
    outputText: string;
    config: NormalizedRlmConfig;
    context: {
      task: string;
      documents: Array<{ docId: string; sourcePath: string; content: string }>;
    };
    trajectory: RlmTrajectoryEntry[];
    recursiveCalls: RecursiveCallTrace[];
    callsUsed: number;
    eventsPath: string;
    iterations: number;
    terminatedBy: 'FINAL' | 'FINAL_VAR' | 'MAX_ITERATIONS';
  }): Promise<RlmRunResult> {
    const outputText = params.outputText.trim() || 'No final answer generated.';
    const outputPayload =
      params.input.output.format === 'json'
        ? JSON.stringify({ answer: outputText }, null, 2)
        : outputText;

    await params.fs.mkdir(dirname(params.outputPath), { recursive: true });
    await params.fs.writeFile(params.outputPath, outputPayload, { overwrite: true, recursive: true });

    const summary = buildRunSummary({
      runId: params.runId,
      input: params.input,
      outputPath: params.outputPath,
      terminatedBy: params.terminatedBy,
      iterations: params.iterations,
      maxIterations: params.config.maxIterations,
      maxCalls: params.config.maxCalls,
      maxDepth: params.config.maxDepth,
      maxOutputChars: params.config.maxOutputChars,
      callsUsed: params.callsUsed,
      context: params.context,
      trajectory: params.trajectory,
      recursiveCalls: params.recursiveCalls,
    });

    await params.fs.writeFile(params.auditPath, JSON.stringify(summary, null, 2), {
      overwrite: true,
      recursive: true,
    });

    await params.fs.writeFile(
      params.recursionPath,
      JSON.stringify(
        {
          runId: params.runId,
          maxCalls: params.config.maxCalls,
          callsUsed: params.callsUsed,
          maxDepth: params.config.maxDepth,
          nodes: params.recursiveCalls,
          terminatedBy: params.terminatedBy,
        },
        null,
        2,
      ),
      {
        overwrite: true,
        recursive: true,
      },
    );

    await params.logger.emit({
      type: 'run.final',
      outputPath: params.outputPath,
      auditPath: params.auditPath,
      recursionPath: params.recursionPath,
      reason: params.terminatedBy,
    });

    return {
      outputPath: params.outputPath,
      auditPath: params.auditPath,
      recursionPath: params.recursionPath,
      eventsPath: params.eventsPath,
      runId: params.runId,
    };
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

  private resolveRootModel(): ModelRef {
    const requested = this.options.rootModel?.id?.trim();
    if (!requested || !requested.includes('/')) {
      return { id: DEFAULT_ROOT_MODEL };
    }

    return { id: requested };
  }

  private resolveSubModel(rootModel: ModelRef): ModelRef {
    const requested = this.options.subModel?.id?.trim();
    if (!requested || !requested.includes('/')) {
      return rootModel;
    }

    return { id: requested };
  }
}

function normalizeConfig(input: RlmRunInput): NormalizedRlmConfig {
  return {
    maxIterations: input.budgets?.maxIterations ?? 30,
    maxCalls: input.budgets?.maxCalls ?? 50,
    maxDepth: input.budgets?.maxDepth ?? 1,
    maxOutputChars: input.budgets?.maxOutputChars ?? 10_000,
  };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function looksLikeMissingVariableError(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('Error: Variable ') && normalized.includes(' not found.');
}
