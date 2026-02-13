import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { Workspace } from '@mastra/core/workspace';
import { z } from 'zod';

import { RlmRunner } from '../rlm';
import type { ModelRef, RlmRunInput } from '../rlm';

const sourceRefSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'folder']).optional(),
});

const runInputSchema = z.object({
  task: z.string(),
  taskType: z.enum(['synthesis', 'analysis', 'extraction', 'comparison', 'review', 'custom']).optional(),
  sources: z.array(sourceRefSchema).min(1),
  output: z.object({
    format: z.enum(['md', 'json']),
    path: z.string(),
  }),
  grounding: z
    .object({
      requireQuotes: z.boolean().optional(),
      allowInference: z.boolean().optional(),
      allowSynthesis: z.boolean().optional(),
    })
    .optional(),
  budgets: z
    .object({
      maxDepth: z.number().int().positive().optional(),
      maxIterations: z.number().int().positive().optional(),
      scannerBatchSize: z.number().int().positive().optional(),
      scannerConcurrency: z.number().int().positive().optional(),
      searchTopK: z.number().int().positive().optional(),
    })
    .optional(),
  contradictionPolicy: z.enum(['fail', 'report']).optional(),
  outputCitations: z.enum(['inline', 'appendix', 'both']).optional(),
});

const runResultSchema = z.object({
  outputPath: z.string(),
  auditPath: z.string(),
  runId: z.string(),
});

export function createRlmWorkflow(params: {
  workspace: Workspace;
  models: {
    controller: ModelRef;
    scanner?: ModelRef;
  };
  defaults?: Partial<Pick<RlmRunInput, 'grounding' | 'budgets' | 'contradictionPolicy' | 'outputCitations'>>;
}) {
  const runStep = createStep({
    id: 'run-rlm',
    inputSchema: runInputSchema.extend({
      controllerModelId: z.string().optional(),
      scannerModelId: z.string().optional(),
    }),
    outputSchema: runResultSchema,
    execute: async ({ inputData }) => {
      const runner = new RlmRunner({
        workspace: params.workspace,
        controllerModel: {
          id: inputData.controllerModelId ?? params.models.controller.id,
        },
        scannerModel:
          inputData.scannerModelId !== undefined
            ? { id: inputData.scannerModelId }
            : params.models.scanner,
      });

      const mergedInput: RlmRunInput = {
        ...inputData,
        grounding: {
          ...params.defaults?.grounding,
          ...inputData.grounding,
        },
        budgets: {
          ...params.defaults?.budgets,
          ...inputData.budgets,
        },
        contradictionPolicy: inputData.contradictionPolicy ?? params.defaults?.contradictionPolicy,
        outputCitations: inputData.outputCitations ?? params.defaults?.outputCitations,
      };

      return runner.run(mergedInput);
    },
  });

  const workflow = createWorkflow({
    id: 'rlm-workflow',
    inputSchema: runInputSchema,
    outputSchema: runResultSchema,
  }).then(runStep);

  workflow.commit();
  return workflow;
}
