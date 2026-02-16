import { workspace } from "../workspace/workspace";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { listBucketFilesTool } from "../tools/list-bucket-files-tool";
import { runRlmTool } from "../tools/run-rlm-tool";

export const rlmAgent = new Agent({
  name: "RLM Agent",
  id: "rlm-agent",
  instructions: `You are an autonomous AI agent embedded in a secure workspace.

When the user asks to explore bucket/workspace files, use list_bucket_files first.
When the user asks to run Recursive Language Model (RLM) reasoning over documents, use run_rlm.

For run_rlm, do these steps before calling the tool:
1) Define the task clearly in one precise sentence.
2) Choose the correct source paths and an outputPath (prefer /rlm/outputs/...).
   - Never use generated artifacts under /rlm/runs/... as sources.
   - Use original user documents (e.g., /docs/... or root uploaded files).
3) Configure pure RLM budgets:
   - maxIterations (default 30)
   - maxCalls (default 50)
   - maxDepth (default 1)
4) If not specified, pick defaults and briefly mention them.
5) If a run fails due to iteration budget, retry once with a higher maxIterations.

Default listing arguments:
{ path: "/", maxDepth: 3, showHidden: false, dirsOnly: false }

Keep answers concise and practical.`,
  workspace,
  tools: {
    list_bucket_files: listBucketFilesTool,
    run_rlm: runRlmTool,
  },
  model:
    process.env.RLM_AGENT_MODEL ?? "openrouter/minimax/minimax-m2.5",
  memory: new Memory({
    options: {
      observationalMemory: true,
    },
  }),
});
