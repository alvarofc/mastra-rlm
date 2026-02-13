import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

import { RlmRunner } from '../runner';
import type {
  ControllerAction,
  ControllerAdapter,
  DraftOutput,
  RlmRunInput,
  VerifyOutput,
} from '../types';

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const cleanup = cleanupTasks.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe('RlmRunner acceptance tests', () => {
  test('Grounding enforcement', async () => {
    const { workspace, fs } = await createTestWorkspace('grounding');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile(
      '/inputs/policy.txt',
      'All requests must be approved by Admin within 30 days.',
      { recursive: true, overwrite: true },
    );

    const controller = scriptedController({
      actions: [
        { action: 'SEARCH', queries: ['approved', 'admin', '30 days'], reasoning: 'find policy' },
        { action: 'DRAFT', reasoning: 'write summary' },
        { action: 'VERIFY', reasoning: 'verify claims' },
        { action: 'FINALIZE', reasoning: 'done' },
      ],
      drafts: {
        1: {
          text: 'Policy summary: Requests require Admin approval within 30 days.',
          claims: [
            {
              id: 'c1',
              text: 'Requests require Admin approval within 30 days.',
              evidence: [
                {
                  docId: 'doc0',
                  chunkId: 'doc0-chunk-0000',
                  quote: 'All requests must be approved by Admin within 30 days.',
                },
              ],
            },
          ],
        },
      },
      verifies: {
        2: {
          verdicts: [{ claimId: 'c1', status: 'SUPPORTED', notes: 'quote matches source' }],
          overall: 'OK',
        },
      },
    });

    const runner = new RlmRunner({
      workspace,
      controllerModel: { id: 'mock/controller' },
      adapters: { controller },
    });

    const input: RlmRunInput = {
      task: 'Generate a policy summary.',
      sources: [{ path: '/inputs/policy.txt' }],
      output: { format: 'md', path: '/outputs/policy-summary.md' },
      grounding: { requireQuotes: true, allowInference: false },
      budgets: { maxIterations: 10, maxDepth: 3 },
    };

    const result = await runner.run(input);
    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as {
      claims: Array<{
        status: string;
        evidence: Array<{ docId: string; chunkId: string; quote: string }>;
      }>;
    };

    expect(audit.claims.length).toBe(1);
    for (const claim of audit.claims) {
      for (const evidence of claim.evidence) {
        const chunkPath = `/rlm/runs/${result.runId}/chunks/${evidence.docId}/${evidence.chunkId}.json`;
        const chunk = JSON.parse((await fs.readFile(chunkPath, { encoding: 'utf8' })) as string) as {
          text: string;
        };
        expect(chunk.text.includes(evidence.quote)).toBeTrue();
      }
      expect(claim.status).not.toBe('UNSUPPORTED');
    }
  });

  test('Missing info behavior', async () => {
    const { workspace, fs } = await createTestWorkspace('missing');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/terms.txt', 'This document describes shipping timelines only.', {
      recursive: true,
      overwrite: true,
    });

    const controller = scriptedController({
      actions: [
        { action: 'SEARCH', queries: ['refund policy'], reasoning: 'look for refunds' },
        { action: 'DRAFT', reasoning: 'draft with missing-info fallback' },
        { action: 'VERIFY', reasoning: 'verify no claims' },
        { action: 'FINALIZE', reasoning: 'done' },
      ],
      drafts: {
        1: {
          text: 'Refund policy: Not specified in the provided documents.',
          claims: [],
        },
      },
      verifies: {
        2: {
          verdicts: [],
          overall: 'OK',
        },
      },
    });

    const runner = new RlmRunner({
      workspace,
      controllerModel: { id: 'mock/controller' },
      adapters: { controller },
    });

    const result = await runner.run({
      task: 'Generate a refund policy.',
      sources: [{ path: '/inputs/terms.txt' }],
      output: { format: 'md', path: '/outputs/refund-policy.md' },
      grounding: { requireQuotes: true, allowInference: false },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('Not specified in the provided documents');

    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as {
      claims: Array<{ status: string }>;
    };
    const supported = audit.claims.filter(claim => claim.status === 'SUPPORTED');
    expect(supported.length).toBe(0);
  });

  test('Contradiction handling (report)', async () => {
    const { workspace, fs } = await createTestWorkspace('contradiction');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc-a.txt', 'The deadline is 30 days.', {
      recursive: true,
      overwrite: true,
    });
    await fs.writeFile('/inputs/doc-b.txt', 'The deadline is 45 days.', {
      recursive: true,
      overwrite: true,
    });

    const controller = scriptedController({
      actions: [
        { action: 'SEARCH', queries: ['deadline'], reasoning: 'find deadline references' },
        { action: 'DRAFT', reasoning: 'draft contradiction summary' },
        { action: 'VERIFY', reasoning: 'mark contradiction' },
        { action: 'FINALIZE', reasoning: 'report contradiction' },
      ],
      drafts: {
        1: {
          text: 'Conflict found: one source states 30 days and another states 45 days.',
          claims: [
            {
              id: 'c1',
              text: 'The deadline is inconsistent across sources.',
              evidence: [
                { docId: 'doc0', chunkId: 'doc0-chunk-0000', quote: 'The deadline is 30 days.' },
                { docId: 'doc1', chunkId: 'doc1-chunk-0000', quote: 'The deadline is 45 days.' },
              ],
            },
          ],
        },
      },
      verifies: {
        2: {
          verdicts: [
            {
              claimId: 'c1',
              status: 'CONTRADICTED',
              notes: 'Sources disagree on exact deadline.',
            },
          ],
          overall: 'CONTRADICTION',
        },
      },
    });

    const runner = new RlmRunner({
      workspace,
      controllerModel: { id: 'mock/controller' },
      adapters: { controller },
    });

    const result = await runner.run({
      task: 'Determine the deadline.',
      sources: [{ path: '/inputs/doc-a.txt' }, { path: '/inputs/doc-b.txt' }],
      output: { format: 'md', path: '/outputs/deadline.md' },
      contradictionPolicy: 'report',
      grounding: { requireQuotes: true, allowInference: false },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('30 days');
    expect(output).toContain('45 days');

    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as {
      claims: Array<{ status: string }>;
    };
    expect(audit.claims[0]?.status).toBe('CONTRADICTED');
  });

  test('Folder source loading', async () => {
    const { workspace, fs } = await createTestWorkspace('folder');
    await fs.mkdir('/inputs/batch', { recursive: true });
    await fs.writeFile('/inputs/batch/doc1.txt', 'Doc one text about approvals.', {
      recursive: true,
      overwrite: true,
    });
    await fs.writeFile('/inputs/batch/doc2.txt', 'Doc two text about timelines.', {
      recursive: true,
      overwrite: true,
    });

    const controller = scriptedController({
      actions: [
        { action: 'SEARCH', queries: ['approvals', 'timelines'], reasoning: 'search all docs' },
        { action: 'DRAFT', reasoning: 'draft summary' },
        { action: 'VERIFY', reasoning: 'verify' },
        { action: 'FINALIZE', reasoning: 'done' },
      ],
      drafts: {
        1: {
          text: 'Documents include approvals and timelines.',
          claims: [
            {
              id: 'c1',
              text: 'The documents discuss approvals and timelines.',
              evidence: [
                {
                  docId: 'doc0',
                  chunkId: 'doc0-chunk-0000',
                  quote: 'Doc one text about approvals.',
                },
              ],
            },
          ],
        },
      },
      verifies: {
        2: {
          verdicts: [{ claimId: 'c1', status: 'SUPPORTED', notes: 'supported by source' }],
          overall: 'OK',
        },
      },
    });

    const runner = new RlmRunner({
      workspace,
      controllerModel: { id: 'mock/controller' },
      adapters: { controller },
    });

    const result = await runner.run({
      task: 'Summarize all docs in folder.',
      sources: [{ path: '/inputs/batch', type: 'folder' }],
      output: { format: 'md', path: '/outputs/folder-summary.md' },
      grounding: { requireQuotes: true, allowInference: false },
    });

    const copiedEntries = await fs.readdir(`/rlm/runs/${result.runId}/sources`);
    expect(copiedEntries.filter(entry => entry.type === 'file').length).toBe(2);
  });
});

function scriptedController(script: {
  actions: ControllerAction[];
  drafts?: Record<number, DraftOutput>;
  verifies?: Record<number, VerifyOutput>;
  revises?: Record<number, DraftOutput>;
}): ControllerAdapter {
  return {
    async decideNextAction(context) {
      return (
        script.actions[context.iteration] ?? {
          action: 'FINALIZE',
          reasoning: 'fallback finalize',
        }
      );
    },
    async draft(context) {
      const draft = script.drafts?.[context.iteration];
      if (!draft) {
        throw new Error(`Missing draft script for iteration ${context.iteration}`);
      }
      return draft;
    },
    async verify(context) {
      const verify = script.verifies?.[context.iteration];
      if (!verify) {
        throw new Error(`Missing verify script for iteration ${context.iteration}`);
      }
      return verify;
    },
    async revise(context) {
      const revise = script.revises?.[context.iteration];
      if (!revise) {
        throw new Error(`Missing revise script for iteration ${context.iteration}`);
      }
      return revise;
    },
  };
}

async function createTestWorkspace(suffix: string): Promise<{
  workspace: Workspace;
  fs: NonNullable<Workspace['filesystem']>;
}> {
  const basePath = await mkdtemp(join(tmpdir(), `rlm-${suffix}-`));
  const filesystem = new LocalFilesystem({ basePath });
  const workspace = new Workspace({
    id: `rlm-${suffix}`,
    filesystem,
    bm25: true,
  });

  await workspace.init();

  cleanupTasks.push(async () => {
    await workspace.destroy();
    await rm(basePath, { recursive: true, force: true });
  });

  return {
    workspace,
    fs: filesystem,
  };
}
