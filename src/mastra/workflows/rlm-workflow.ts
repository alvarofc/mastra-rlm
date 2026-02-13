import { createRlmWorkflow } from '../rlm-workflow';
import { workspace } from '../workspace/workspace';

const controllerModelId = process.env.RLM_CONTROLLER_MODEL ?? 'groq/llama-3.3-70b-versatile';
const scannerModelId = process.env.RLM_SCANNER_MODEL;

export const rlmWorkflow = createRlmWorkflow({
  workspace,
  models: {
    controller: { id: controllerModelId },
    scanner: scannerModelId ? { id: scannerModelId } : undefined,
  },
  defaults: {
    grounding: {
      requireQuotes: true,
      allowInference: false,
      allowSynthesis: true,
    },
    budgets: {
      maxDepth: 5,
      maxIterations: 200,
      scannerBatchSize: 20,
      scannerConcurrency: 4,
      searchTopK: 1000,
    },
    contradictionPolicy: 'report',
    outputCitations: 'both',
  },
});
