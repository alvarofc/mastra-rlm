import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { RlmRunner } from '../runner';
import type {
  RlmMessage,
  RlmRootModelAdapter,
  RlmRunSummary,
  RlmSubModelAdapter,
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

describe('RlmRunner pure loop', () => {
  test('terminates with FINAL marker', async () => {
    const { workspace, fs } = await createTestWorkspace('final-marker');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc.txt', 'The deadline is 30 days.', {
      recursive: true,
      overwrite: true,
    });

    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel([
          [
            '```repl',
            'doc = context["documents"][0]["content"]',
            'print(doc)',
            '```',
          ].join('\n'),
          ['```repl', 'FINAL("The deadline is 30 days.")', '```'].join('\n'),
        ]),
        sub: scriptedSubModel({
          query: async () => '',
          queryBatched: async () => [],
        }),
      },
    });

    const result = await runner.run({
      task: 'What is the deadline?',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/final-marker.md' },
      budgets: { maxIterations: 5, maxCalls: 50, maxDepth: 1 },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('30 days');

    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as RlmRunSummary;
    expect(audit.terminatedBy).toBe('FINAL');
    expect(audit.iterations).toBe(2);
  });

  test('supports FINAL_VAR retrieval from REPL namespace', async () => {
    const { workspace, fs } = await createTestWorkspace('final-var');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc.txt', 'The project grading has a maximum of 10 points.', {
      recursive: true,
      overwrite: true,
    });

    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel([
          [
            '```repl',
            'answer = "The project grading has a maximum of 10 points."',
            'print(answer)',
            '```',
          ].join('\n'),
          ['```repl', 'FINAL_VAR("answer")', '```'].join('\n'),
        ]),
        sub: scriptedSubModel({
          query: async () => '',
          queryBatched: async () => [],
        }),
      },
    });

    const result = await runner.run({
      task: 'What is the maximum score?',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/final-var.md' },
      budgets: { maxIterations: 5, maxCalls: 50, maxDepth: 1 },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('maximum of 10 points');

    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as RlmRunSummary;
    expect(audit.terminatedBy).toBe('FINAL_VAR');
  });

  test('llm_query uses sub model adapter and records usage', async () => {
    const { workspace, fs } = await createTestWorkspace('llm-query');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc.txt', 'Dummy context.', {
      recursive: true,
      overwrite: true,
    });

    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel([
          [
            '```repl',
            'answer = llm_query("What value should I return?")',
            'print(answer)',
            '```',
          ].join('\n'),
          ['```repl', 'FINAL_VAR("answer")', '```'].join('\n'),
        ]),
        sub: scriptedSubModel({
          query: async input => `sub:${input.prompt}`,
          queryBatched: async input => input.prompts.map(prompt => `sub:${prompt}`),
        }),
      },
    });

    const result = await runner.run({
      task: 'Call sub model once.',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/llm-query.md' },
      budgets: { maxIterations: 5, maxCalls: 50, maxDepth: 1 },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('sub:What value should I return?');

    const recursion = JSON.parse(
      (await fs.readFile(result.recursionPath, { encoding: 'utf8' })) as string,
    ) as { callsUsed: number; nodes: Array<{ promptCount: number }> };
    expect(recursion.callsUsed).toBe(1);
    expect(recursion.nodes[0]?.promptCount).toBe(1);
  });

  test('enforces maxCalls across llm_query_batched prompt count', async () => {
    const { workspace, fs } = await createTestWorkspace('max-calls');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc.txt', 'Dummy context.', {
      recursive: true,
      overwrite: true,
    });

    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel([
          [
            '```repl',
            'prompts = ["one", "two", "three"]',
            'answers = llm_query_batched(prompts)',
            'print(answers)',
            '```',
          ].join('\n'),
          ['```repl', 'FINAL("Max call budget was exceeded.")', '```'].join('\n'),
        ]),
        sub: scriptedSubModel({
          query: async () => 'unused',
          queryBatched: async input => input.prompts.map(() => 'unused'),
        }),
      },
    });

    const result = await runner.run({
      task: 'Trigger budget error.',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/max-calls.md' },
      budgets: { maxIterations: 5, maxCalls: 2, maxDepth: 1 },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('Max call budget was exceeded');

    const events = await readEvents(fs, result.eventsPath);
    const replResult = events.find(event => event.type === 'repl.result') as
      | { stderr: string }
      | undefined;
    expect(replResult?.stderr ?? '').toContain('LLM call limit exceeded');

    const recursion = JSON.parse(
      (await fs.readFile(result.recursionPath, { encoding: 'utf8' })) as string,
    ) as { callsUsed: number };
    expect(recursion.callsUsed).toBe(0);
  });

  test('uses fallback after max iterations', async () => {
    const { workspace, fs } = await createTestWorkspace('max-iterations');
    await fs.mkdir('/inputs', { recursive: true });
    await fs.writeFile('/inputs/doc.txt', 'Fallback context.', {
      recursive: true,
      overwrite: true,
    });

    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel([
          ['```repl', 'print("step1")', '```'].join('\n'),
          ['```repl', 'print("step2")', '```'].join('\n'),
          'FINAL(Fallback final answer.)',
        ]),
        sub: scriptedSubModel({
          query: async () => '',
          queryBatched: async () => [],
        }),
      },
    });

    const result = await runner.run({
      task: 'Reach max iterations.',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/fallback.md' },
      budgets: { maxIterations: 2, maxCalls: 10, maxDepth: 1 },
    });

    const output = (await fs.readFile(result.outputPath, { encoding: 'utf8' })) as string;
    expect(output).toContain('Fallback final answer');

    const audit = JSON.parse((await fs.readFile(result.auditPath, { encoding: 'utf8' })) as string) as RlmRunSummary;
    expect(audit.terminatedBy).toBe('MAX_ITERATIONS');
    expect(audit.iterations).toBe(2);
  });

  test('does not inject raw context text into root prompt history', async () => {
    const { workspace, fs } = await createTestWorkspace('context-isolation');
    await fs.mkdir('/inputs', { recursive: true });
    const sentinel = 'VERY_SECRET_CONTEXT_STRING_12345';
    await fs.writeFile('/inputs/doc.txt', `prefix ${sentinel} suffix`, {
      recursive: true,
      overwrite: true,
    });

    const seenPrompts: string[] = [];
    const runner = new RlmRunner({
      workspace,
      rootModel: { id: 'mock/root' },
      adapters: {
        root: scriptedRootModel(['FINAL(done)'], messages => {
          seenPrompts.push(messages.map(message => message.content).join('\n\n'));
        }),
        sub: scriptedSubModel({
          query: async () => '',
          queryBatched: async () => [],
        }),
      },
    });

    await runner.run({
      task: 'Finish immediately.',
      sources: [{ path: '/inputs/doc.txt' }],
      output: { format: 'md', path: '/outputs/context-isolation.md' },
      budgets: { maxIterations: 1, maxCalls: 5, maxDepth: 1 },
    });

    expect(seenPrompts.length).toBeGreaterThan(0);
    for (const prompt of seenPrompts) {
      expect(prompt.includes(sentinel)).toBeFalse();
    }
  });
});

function scriptedRootModel(
  responses: string[],
  onCall?: (messages: RlmMessage[]) => void,
): RlmRootModelAdapter {
  let index = 0;

  return {
    async generate(messages: RlmMessage[]): Promise<string> {
      onCall?.(messages);
      const response = responses[index] ?? responses[responses.length - 1] ?? 'FINAL(No response provided.)';
      index += 1;
      return response;
    },
  };
}

function scriptedSubModel(impl: {
  query: (input: { prompt: string; modelId?: string; depth: number }) => Promise<string>;
  queryBatched: (input: { prompts: string[]; modelId?: string; depth: number }) => Promise<string[]>;
}): RlmSubModelAdapter {
  return {
    query: impl.query,
    queryBatched: impl.queryBatched,
  };
}

async function readEvents(
  fs: NonNullable<Workspace['filesystem']>,
  path: string,
): Promise<Array<Record<string, any>>> {
  const raw = (await fs.readFile(path, { encoding: 'utf8' })) as string;
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, any>);
}

async function createWorkspace(suffix: string): Promise<{
  workspace: Workspace;
  fs: NonNullable<Workspace['filesystem']>;
}> {
  const basePath = await mkdtemp(join(tmpdir(), `rlm-${suffix}-`));
  const filesystem = new LocalFilesystem({ basePath });
  const workspace = new Workspace({
    id: `rlm-${suffix}`,
    filesystem,
    sandbox: new LocalSandbox({
      workingDirectory: basePath,
      env: process.env,
    }),
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

async function createTestWorkspace(suffix: string): Promise<{
  workspace: Workspace;
  fs: NonNullable<Workspace['filesystem']>;
}> {
  return createWorkspace(suffix);
}
