import { createRlmTool } from "mastra-rlm-kit";

import { workspace } from "../workspace/workspace";

export const runRlmTool = createRlmTool({
  workspace,
  defaults: {
    budgets: {
      maxIterations: 30,
      maxCalls: 50,
      maxDepth: 1,
      maxOutputChars: 10_000,
    },
  },
});
