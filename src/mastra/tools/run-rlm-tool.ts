import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { RlmRunner } from "../rlm";
import { workspace } from "../workspace/workspace";

const sourceSchema = z.object({
  path: z
    .string()
    .describe(
      "Workspace path to a file or folder, e.g. /docs/policy.pdf or /docs/batch",
    ),
  type: z.enum(["file", "folder"]).optional(),
});

export const runRlmTool = createTool({
  id: "run-rlm",
  description:
    "Run grounded RLM on workspace files/folders and produce output + audit artifacts. Before calling, define a specific task sentence and choose settings for complexity (iterations/depth/searchTopK).",
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "Precise generation objective. Be specific about required output scope (e.g., compare deadlines, approvals, and exceptions across two policies).",
      ),
    sources: z
      .array(sourceSchema)
      .min(1)
      .describe("Input sources from workspace filesystem"),
    outputPath: z
      .string()
      .describe(
        "Workspace path for generated output, e.g. /rlm/outputs/report.md",
      ),
    outputFormat: z.enum(["md", "json"]).optional().default("md"),
    taskType: z
      .enum([
        "synthesis",
        "analysis",
        "extraction",
        "comparison",
        "review",
        "custom",
      ])
      .optional(),
    controllerModelId: z.string().optional(),
    scannerModelId: z.string().optional(),
    requireQuotes: z.boolean().optional().default(true),
    allowInference: z.boolean().optional().default(false),
    allowSynthesis: z.boolean().optional().default(true),
    maxDepth: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Recursion depth. Use 4-6 for normal tasks, 6-8 for deep analysis."),
    maxIterations: z
      .number()
      .int()
      .positive()
      .optional()
      .default(200)
      .describe("Main loop budget. Use 40-80 simple, 80-200 complex comparisons."),
    scannerBatchSize: z.number().int().positive().optional(),
    scannerConcurrency: z.number().int().positive().optional(),
    searchTopK: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Retrieval breadth. Use 400-800 focused tasks, 800-2000 for broad folder analysis.",
      ),
    contradictionPolicy: z.enum(["fail", "report"]).optional(),
    outputCitations: z.enum(["inline", "appendix", "both"]).optional(),
  }),
  outputSchema: z.object({
    runId: z.string(),
    outputPath: z.string(),
    auditPath: z.string(),
  }),
  execute: async (input) => {
    const controllerModelId =
      input.controllerModelId ??
      process.env.RLM_CONTROLLER_MODEL ??
      "groq/llama-3.3-70b-versatile";
    const scannerModelId =
      input.scannerModelId ?? process.env.RLM_SCANNER_MODEL;

    const runner = new RlmRunner({
      workspace,
      controllerModel: { id: controllerModelId },
      scannerModel: scannerModelId ? { id: scannerModelId } : undefined,
    });

    return runner.run({
      task: input.task,
      taskType: input.taskType,
      sources: input.sources,
      output: {
        format: input.outputFormat,
        path: input.outputPath,
      },
      grounding: {
        requireQuotes: input.requireQuotes,
        allowInference: input.allowInference,
        allowSynthesis: input.allowSynthesis,
      },
      budgets: {
        maxDepth: input.maxDepth,
        maxIterations: input.maxIterations,
        scannerBatchSize: input.scannerBatchSize,
        scannerConcurrency: input.scannerConcurrency,
        searchTopK: input.searchTopK,
      },
      contradictionPolicy: input.contradictionPolicy,
      outputCitations: input.outputCitations,
    });
  },
});
