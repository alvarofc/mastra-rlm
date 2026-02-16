import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { RlmRunner } from "../rlm";
import { workspace } from "../workspace/workspace";

const DEFAULT_ROOT_MODEL = "openrouter/moonshotai/kimi-k2.5";
const DEFAULT_SUB_MODEL = "openrouter/minimax/minimax-m2.5";

const prepareInputSchema = z.object({
  outputPath: z.string().optional(),
  extraSources: z.array(z.string()).optional(),
  includeProjectTree: z.boolean().optional(),
  maxTreeDepth: z.number().int().min(1).max(8).optional(),
  articleFocus: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  maxCalls: z.number().int().positive().optional(),
  maxOutputChars: z.number().int().positive().optional(),
  rootModelId: z.string().optional(),
  subModelId: z.string().optional(),
});

const preparedSchema = z.object({
  task: z.string(),
  outputPath: z.string(),
  sources: z.array(z.object({ path: z.string(), type: z.enum(["file", "folder"]).optional() })),
  maxIterations: z.number().int().positive(),
  maxCalls: z.number().int().positive(),
  maxOutputChars: z.number().int().positive(),
  rootModelId: z.string(),
  subModelId: z.string(),
  projectTreePath: z.string().optional(),
});

const runOutputSchema = z.object({
  runId: z.string(),
  outputPath: z.string(),
  auditPath: z.string(),
  eventsPath: z.string(),
  recursionPath: z.string(),
  projectTreePath: z.string().optional(),
  sourcesUsed: z.array(z.string()),
});

const prepareProjectContextStep = createStep({
  id: "prepare-project-article-context",
  inputSchema: prepareInputSchema,
  outputSchema: preparedSchema,
  execute: async ({ inputData }) => {
    const fs = workspace.filesystem;
    if (!fs) {
      throw new Error("Workspace filesystem is not configured");
    }

    const outputPath = normalizePath(inputData.outputPath ?? "/rlm/outputs/project-technical-article.md");
    const maxIterations = inputData.maxIterations ?? 60;
    const maxCalls = inputData.maxCalls ?? 120;
    const maxOutputChars = inputData.maxOutputChars ?? 30_000;
    const rootModelId = normalizeModelId(inputData.rootModelId) ?? DEFAULT_ROOT_MODEL;
    const subModelId = normalizeModelId(inputData.subModelId) ?? DEFAULT_SUB_MODEL;

    const projectSources = [
      "/README.md",
      "/RLM_PLAN.md",
      "/package.json",
      "/src/mastra/workflows/rlm-workflow.ts",
      "/src/mastra/workflows/project-article-workflow.ts",
      "/src/mastra/tools/run-rlm-tool.ts",
      "/src/mastra/agents/rlm-agent.ts",
      "/packages/mastra-rlm/README.md",
      "/packages/mastra-rlm/docs/mastra-rlm-technical-article.md",
      "/packages/mastra-rlm/src",
    ];

    const extraSources = (inputData.extraSources ?? []).map(path => normalizePath(path));
    const sourceCandidates = [...projectSources, ...extraSources];
    const existingSources = await filterExistingSources(sourceCandidates, fs);

    let projectTreePath: string | undefined;
    if (inputData.includeProjectTree ?? true) {
      projectTreePath = "/rlm/analysis/project-tree.md";
      const depth = inputData.maxTreeDepth ?? 4;
      const tree = await buildProjectTree(fs, "/", depth);
      await fs.mkdir("/rlm/analysis", { recursive: true });
      await fs.writeFile(projectTreePath, tree, { overwrite: true, recursive: true });
      existingSources.unshift(projectTreePath);
    }

    const focus = inputData.articleFocus?.trim();
    const task = buildArticleTask(focus);

    return {
      task,
      outputPath,
      sources: existingSources.map(path => {
        const type: "file" | undefined =
          path.endsWith(".ts") || path.endsWith(".md") || path.endsWith(".json") ? "file" : undefined;
        return { path, type };
      }),
      maxIterations,
      maxCalls,
      maxOutputChars,
      rootModelId,
      subModelId,
      projectTreePath,
    };
  },
});

const writeArticleStep = createStep({
  id: "write-project-article",
  inputSchema: preparedSchema,
  outputSchema: runOutputSchema,
  execute: async ({ inputData }) => {
    const runner = new RlmRunner({
      workspace,
      rootModel: { id: inputData.rootModelId },
      subModel: { id: inputData.subModelId },
    });

    const result = await runner.run({
      task: inputData.task,
      sources: inputData.sources,
      output: {
        format: "md",
        path: inputData.outputPath,
      },
      budgets: {
        maxIterations: inputData.maxIterations,
        maxCalls: inputData.maxCalls,
        maxDepth: 1,
        maxOutputChars: inputData.maxOutputChars,
      },
    });

    return {
      ...result,
      projectTreePath: inputData.projectTreePath,
      sourcesUsed: inputData.sources.map(source => source.path),
    };
  },
});

export const projectArticleWorkflow = createWorkflow({
  id: "project-article-workflow",
  inputSchema: prepareInputSchema,
  outputSchema: runOutputSchema,
})
  .then(prepareProjectContextStep)
  .then(writeArticleStep);

projectArticleWorkflow.commit();

function buildArticleTask(focus?: string): string {
  const focusLine = focus ? `Additional focus requested by user: ${focus}` : "";

  return [
    "Analyze this Mastra project and write a technical article in Markdown.",
    "The article must be clear, deeply technical, and production-oriented.",
    "Required sections:",
    "1) Project overview and motivation",
    "2) Architecture and workflow/tool design",
    "3) Paper-faithful RLM loop mechanics",
    "4) Model routing strategy with root model openrouter/moonshotai/kimi-k2.5 and sub model openrouter/minimax/minimax-m2.5",
    "5) Safety and sandboxing decisions",
    "6) Testing, observability, and run artifacts",
    "7) Portability package design (mastra-rlm-kit) and integration patterns",
    "8) Limitations and next improvements",
    "Include direct references to:",
    "- https://arxiv.org/html/2512.24601v2",
    "- https://dspy.ai/api/modules/RLM/",
    "Use concrete details from the codebase and avoid generic statements.",
    focusLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeModelId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes("/")) return undefined;
  return trimmed;
}

async function filterExistingSources(
  paths: string[],
  fs: NonNullable<typeof workspace.filesystem>,
): Promise<string[]> {
  const deduped = [...new Set(paths.map(path => normalizePath(path)))];
  const existing: string[] = [];

  for (const path of deduped) {
    try {
      await fs.stat(path);
      existing.push(path);
    } catch {
      // Skip missing paths.
    }
  }

  return existing;
}

async function buildProjectTree(
  fs: NonNullable<typeof workspace.filesystem>,
  rootPath: string,
  maxDepth: number,
): Promise<string> {
  const lines = ["# Project Tree", ""];

  await walk(rootPath, 0);
  return lines.join("\n");

  async function walk(path: string, depth: number): Promise<void> {
    const entries = await fs.readdir(path);
    const sorted = entries
      .filter(entry => !entry.name.startsWith("."))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      if (path === "/" && ["node_modules", ".mastra", "tmp"].includes(entry.name)) continue;
      const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;
      lines.push(`${"  ".repeat(depth)}- ${entry.type === "directory" ? "[D]" : "[F]"} ${fullPath}`);
      if (entry.type === "directory" && depth + 1 < maxDepth) {
        await walk(fullPath, depth + 1);
      }
    }
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
