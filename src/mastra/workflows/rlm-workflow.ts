import { createRlmWorkflow } from '../rlm-workflow';
import { workspace } from '../workspace/workspace';

const rootModelId =
  process.env.RLM_ROOT_MODEL ?? process.env.RLM_AGENT_MODEL ?? 'openrouter/minimax/minimax-m2.5';
const subModelId = process.env.RLM_SUB_MODEL ?? rootModelId;

export const rlmWorkflow = createRlmWorkflow({
  workspace,
  models: {
    root: { id: rootModelId },
    sub: { id: subModelId },
  },
  defaults: {
    budgets: {
      maxIterations: 30,
      maxCalls: 50,
      maxDepth: 1,
      maxOutputChars: 10_000,
    },
  },
});
