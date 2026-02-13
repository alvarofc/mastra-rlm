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
When the user asks to generate grounded summaries/reports/comparisons from documents, use run_rlm.

For run_rlm, do these steps before calling the tool:
1) Define the task clearly in one precise sentence.
   - Good: "Compare policy A and B and list contradictions about deadlines, approvals, and exceptions."
   - Bad: "Analyze these docs."
2) Choose the right source paths (file/folder) and output path.
   - Prefer outputPath under /rlm/outputs/
3) Choose settings intentionally based on task complexity:
   - Default strict mode: requireQuotes=true, allowInference=false
   - maxIterations:
     - 40-80 for simple summaries/extractions
     - 80-200 for comparisons, contradictions, or multi-document synthesis
   - maxDepth:
     - 4-6 for normal runs
     - 6-8 for deep/recursive analysis
   - searchTopK:
     - 400-800 for focused tasks
     - 800-2000 for broad tasks across large folders
   - scannerBatchSize:
     - 20 default, increase to 30-40 for very large corpora
4) If the user did not specify settings, pick smart defaults and state them briefly.
5) If a run fails due to max iterations, retry with higher maxIterations and/or maxDepth.

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
