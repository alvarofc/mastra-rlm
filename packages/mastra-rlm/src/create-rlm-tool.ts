import type { Workspace } from '@mastra/core/workspace';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { createRlmRunner } from './create-rlm-runner';
import type { RlmRunInput, RlmSandboxAdapter } from './types';

const sourceSchema = z.object({
  path: z.string().describe('Workspace path to a file or folder, e.g. /docs/policy.pdf or /docs/batch'),
  type: z.enum(['file', 'folder']).optional(),
});

export type CreateRlmToolOptions = {
  workspace: Workspace;
  defaults?: {
    rootModelId?: string;
    subModelId?: string;
    budgets?: NonNullable<RlmRunInput['budgets']>;
  };
  sandboxAdapter?: RlmSandboxAdapter;
  toolId?: string;
  description?: string;
};

export function createRlmTool(options: CreateRlmToolOptions) {
  const fallbackRootModel =
    normalizeRequestedModelId(options.defaults?.rootModelId) ??
    normalizeRequestedModelId(process.env.RLM_ROOT_MODEL) ??
    normalizeRequestedModelId(process.env.RLM_AGENT_MODEL) ??
    'openrouter/minimax/minimax-m2.5';

  const fallbackSubModel =
    normalizeRequestedModelId(options.defaults?.subModelId) ??
    normalizeRequestedModelId(process.env.RLM_SUB_MODEL) ??
    fallbackRootModel;

  const defaultBudgets = options.defaults?.budgets ?? {};

  return createTool({
    id: options.toolId ?? 'run-rlm',
    description:
      options.description ??
      'Run a pure paper-faithful RLM loop over workspace files/folders and produce output + trajectory artifacts.',
    inputSchema: z.object({
      task: z.string().describe('Precise objective for the recursive loop.'),
      sources: z.array(sourceSchema).min(1).describe('Input sources from workspace filesystem'),
      outputPath: z.string().describe('Workspace path for generated output, e.g. /rlm/outputs/report.md'),
      outputFormat: z.enum(['md', 'json']).optional().default('md'),
      rootModelId: z.string().optional(),
      subModelId: z.string().optional(),
      maxIterations: z
        .number()
        .int()
        .positive()
        .optional()
        .default(defaultBudgets.maxIterations ?? 30)
        .describe('Maximum root-loop iterations before fallback finalization.'),
      maxCalls: z
        .number()
        .int()
        .positive()
        .optional()
        .default(defaultBudgets.maxCalls ?? 50)
        .describe('Maximum sub-LLM calls across llm_query/llm_query_batched.'),
      maxDepth: z
        .number()
        .int()
        .positive()
        .optional()
        .default(defaultBudgets.maxDepth ?? 1)
        .describe('Maximum recursion depth allowed for sub-queries.'),
      maxOutputChars: z.number().int().positive().optional().default(defaultBudgets.maxOutputChars ?? 10_000),
    }),
    outputSchema: z.object({
      runId: z.string(),
      outputPath: z.string(),
      auditPath: z.string(),
      eventsPath: z.string(),
      recursionPath: z.string(),
    }),
    execute: async input => {
      const rootModelId = normalizeRequestedModelId(input.rootModelId) ?? fallbackRootModel;
      const subModelId = normalizeRequestedModelId(input.subModelId) ?? fallbackSubModel;

      const runner = createRlmRunner({
        workspace: options.workspace,
        rootModel: { id: rootModelId },
        subModel: { id: subModelId },
        sandboxAdapter: options.sandboxAdapter,
      });

      return runner.run({
        task: input.task,
        sources: input.sources,
        output: {
          format: input.outputFormat,
          path: input.outputPath,
        },
        budgets: {
          maxIterations: input.maxIterations,
          maxCalls: input.maxCalls,
          maxDepth: input.maxDepth,
          maxOutputChars: input.maxOutputChars,
        },
      });
    },
  });
}

function normalizeRequestedModelId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lowered = trimmed.toLowerCase();
  if (lowered === 'default' || lowered === 'auto' || lowered === 'none') {
    return undefined;
  }

  if (!trimmed.includes('/')) {
    return undefined;
  }

  return trimmed;
}
