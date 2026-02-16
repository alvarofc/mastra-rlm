import type { Workspace } from '@mastra/core/workspace';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { createRlmRunner } from './create-rlm-runner';
import type { ModelRef, RlmRunInput, RlmSandboxAdapter } from './types';

const sourceRefSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'folder']).optional(),
});

const runInputSchema = z.object({
  task: z.string(),
  sources: z.array(sourceRefSchema).min(1),
  output: z.object({
    format: z.enum(['md', 'json']),
    path: z.string(),
  }),
  budgets: z
    .object({
      maxIterations: z.number().int().positive().optional(),
      maxCalls: z.number().int().positive().optional(),
      maxDepth: z.number().int().positive().optional(),
      maxOutputChars: z.number().int().positive().optional(),
    })
    .optional(),
});

const runInputWithModelsSchema = runInputSchema.extend({
  rootModelId: z.string().optional(),
  subModelId: z.string().optional(),
});

const runResultSchema = z.object({
  outputPath: z.string(),
  auditPath: z.string(),
  eventsPath: z.string(),
  recursionPath: z.string(),
  runId: z.string(),
});

export type CreateRlmWorkflowOptions = {
  workspace: Workspace;
  models: {
    root: ModelRef;
    sub?: ModelRef;
  };
  defaults?: Partial<Pick<RlmRunInput, 'budgets'>>;
  sandboxAdapter?: RlmSandboxAdapter;
};

export function createRlmWorkflow(options: CreateRlmWorkflowOptions) {
  const runStep = createStep({
    id: 'run-rlm',
    inputSchema: runInputWithModelsSchema,
    outputSchema: runResultSchema,
    execute: async ({ inputData }) => {
      const requestedRoot = normalizeRequestedModelId(inputData.rootModelId);
      const requestedSub = normalizeRequestedModelId(inputData.subModelId);

      const runner = createRlmRunner({
        workspace: options.workspace,
        rootModel: {
          id: requestedRoot ?? options.models.root.id,
        },
        subModel: requestedSub ? { id: requestedSub } : options.models.sub,
        sandboxAdapter: options.sandboxAdapter,
      });

      const mergedInput: RlmRunInput = {
        ...inputData,
        budgets: {
          ...options.defaults?.budgets,
          ...inputData.budgets,
        },
      };

      return runner.run(mergedInput);
    },
  });

  const workflow = createWorkflow({
    id: 'rlm-workflow',
    inputSchema: runInputWithModelsSchema,
    outputSchema: runResultSchema,
  }).then(runStep);

  workflow.commit();
  return workflow;
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
