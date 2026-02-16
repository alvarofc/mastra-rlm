import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { createRlmRunner } from "mastra-rlm-kit";
import type { RlmRunSummary } from "mastra-rlm-kit";

type CliOptions = {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  cases: number;
  rowsPerRequest: number;
  questionTypes?: string[];
  minContextChars?: number;
  maxContextChars?: number;
  maxIterations: number;
  maxCalls: number;
  maxDepth: number;
  maxOutputChars: number;
  rootModelId?: string;
  subModelId?: string;
  reportPath: string;
  keepWorkspace: boolean;
  workspaceDir?: string;
  dryRun: boolean;
  help: boolean;
};

type DatasetRow = {
  id?: string;
  context_window_id?: string;
  context_window_text?: string;
  question?: string;
  answer?: string | number;
  question_type?: string;
  episodes?: number[];
  campaign?: string;
};

type OolongCase = {
  id: string;
  datasetRowIndex: number;
  sourcePath: string;
  outputPath: string;
  question: string;
  expectedAnswer: string;
  questionType: string;
  contextChars: number;
  campaign?: string;
};

type OolongCaseResult = OolongCase & {
  skipped: boolean;
  durationMs?: number;
  runId?: string;
  predictedAnswer?: string;
  outputSnippet?: string;
  auditPath?: string;
  eventsPath?: string;
  recursionPath?: string;
  correct?: boolean;
  iterations?: number;
  subLlmCalls?: number;
  terminatedBy?: string;
  error?: string;
};

type WorkspaceContext = {
  workspace: Workspace;
  fs: NonNullable<Workspace["filesystem"]>;
  basePath: string;
};

type OolongReport = {
  generatedAt: string;
  workspaceBasePath: string;
  reportPath: string;
  dataset: {
    name: string;
    config: string;
    split: string;
    offset: number;
    requestedCases: number;
    rowsPerRequest: number;
    questionTypes?: string[];
    minContextChars?: number;
    maxContextChars?: number;
  };
  models: {
    rootModelId: string;
    subModelId: string;
  };
  options: {
    maxIterations: number;
    maxCalls: number;
    maxDepth: number;
    maxOutputChars: number;
    dryRun: boolean;
  };
  totals: {
    cases: number;
    completed: number;
    failed: number;
    skipped: number;
    correct: number;
    accuracy: number;
  };
  byQuestionType: Array<{
    questionType: string;
    completed: number;
    correct: number;
    accuracy: number;
    avgDurationMs: number;
  }>;
  byContextBucket: Array<{
    bucket: string;
    completed: number;
    correct: number;
    accuracy: number;
  }>;
  results: OolongCaseResult[];
};

const DEFAULT_OPTIONS: CliOptions = {
  dataset: "oolongbench/oolong-real",
  config: "dnd",
  split: "validation",
  offset: 0,
  cases: 20,
  rowsPerRequest: 2,
  maxIterations: 40,
  maxCalls: 120,
  maxDepth: 1,
  maxOutputChars: 10_000,
  reportPath: "/benchmarks/oolong-real/reports/latest-report.json",
  keepWorkspace: true,
  dryRun: false,
  help: false,
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const models = resolveModels(options);
  const workspaceContext = await createWorkspace(options.workspaceDir);

  try {
    const testCases = await prepareCases(workspaceContext.fs, options);
    const results = await runCases(workspaceContext, options, models, testCases);
    const report = buildReport(options, models, workspaceContext.basePath, results);

    const reportPath = normalizeWorkspacePath(options.reportPath);
    await workspaceContext.fs.mkdir(dirname(reportPath), { recursive: true });
    await workspaceContext.fs.writeFile(reportPath, JSON.stringify(report, null, 2), {
      recursive: true,
      overwrite: true,
    });

    printSummary(report, reportPath);
  } finally {
    await workspaceContext.workspace.destroy();
    if (!options.keepWorkspace) {
      await rm(workspaceContext.basePath, { recursive: true, force: true });
    }
  }
}

async function createWorkspace(workspaceDir?: string): Promise<WorkspaceContext> {
  const basePath = workspaceDir ? resolve(workspaceDir) : await mkdtemp(join(tmpdir(), "oolong-real-"));
  await mkdir(basePath, { recursive: true });

  const filesystem = new LocalFilesystem({ basePath });
  const workspace = new Workspace({
    id: "oolong-real-benchmark",
    name: "oolong-real-benchmark",
    filesystem,
    sandbox: new LocalSandbox({
      workingDirectory: basePath,
      env: process.env,
    }),
    bm25: true,
  });
  await workspace.init();

  return {
    workspace,
    fs: filesystem,
    basePath,
  };
}

async function prepareCases(
  fs: NonNullable<Workspace["filesystem"]>,
  options: CliOptions,
): Promise<OolongCase[]> {
  const sourceRoot = "/benchmarks/oolong-real/sources";
  await fs.mkdir(sourceRoot, { recursive: true });

  const requiredCases = options.cases;
  const testCases: OolongCase[] = [];
  let nextOffset = options.offset;

  while (testCases.length < requiredCases) {
    const rows = await fetchRows(options, nextOffset, options.rowsPerRequest);
    if (rows.length === 0) break;

    for (const rowWrapper of rows) {
      nextOffset += 1;

      const row = rowWrapper.row;
      if (!row) continue;
      if (!row.context_window_text || !row.question || row.answer === undefined || row.answer === null) continue;

      const questionType = String(row.question_type ?? "unknown");
      if (options.questionTypes && options.questionTypes.length > 0 && !options.questionTypes.includes(questionType)) {
        continue;
      }

      const contextText = String(row.context_window_text);
      const contextChars = contextText.length;

      if (options.minContextChars !== undefined && contextChars < options.minContextChars) continue;
      if (options.maxContextChars !== undefined && contextChars > options.maxContextChars) continue;

      const baseId = String(row.id ?? `${options.split}-${rowWrapper.row_idx}`);
      const id = sanitizeId(baseId);
      const sourcePath = `${sourceRoot}/${id}.txt`;
      const outputPath = `/benchmarks/oolong-real/outputs/${id}.md`;

      await fs.writeFile(sourcePath, contextText, {
        recursive: true,
        overwrite: true,
      });

      testCases.push({
        id,
        datasetRowIndex: rowWrapper.row_idx,
        sourcePath,
        outputPath,
        question: String(row.question),
        expectedAnswer: String(row.answer),
        questionType,
        contextChars,
        campaign: row.campaign ? String(row.campaign) : undefined,
      });

      if (testCases.length >= requiredCases) break;
    }
  }

  if (testCases.length === 0) {
    throw new Error("No dataset rows matched the requested filters.");
  }

  return testCases;
}

async function fetchRows(
  options: CliOptions,
  offset: number,
  length: number,
): Promise<Array<{ row_idx: number; row: DatasetRow }>> {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", options.dataset);
  url.searchParams.set("config", options.config);
  url.searchParams.set("split", options.split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Dataset server error ${response.status}: ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      rows?: Array<{ row_idx?: number; row?: DatasetRow }>;
    };

    const rows = payload.rows ?? [];
    return rows.map((item, index) => ({
      row_idx: item.row_idx ?? offset + index,
      row: item.row ?? {},
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function runCases(
  context: WorkspaceContext,
  options: CliOptions,
  models: { rootModelId: string; subModelId: string },
  testCases: OolongCase[],
): Promise<OolongCaseResult[]> {
  if (options.dryRun) {
    return testCases.map(testCase => ({
      ...testCase,
      skipped: true,
    }));
  }

  const runner = createRlmRunner({
    workspace: context.workspace,
    rootModel: { id: models.rootModelId },
    subModel: { id: models.subModelId },
  });

  const results: OolongCaseResult[] = [];

  for (const testCase of testCases) {
    const startedAt = Date.now();

    try {
      const runResult = await runner.run({
        task: buildTaskPrompt(testCase.question),
        sources: [{ path: testCase.sourcePath, type: "file" }],
        output: {
          format: "md",
          path: testCase.outputPath,
        },
        budgets: {
          maxIterations: options.maxIterations,
          maxCalls: options.maxCalls,
          maxDepth: options.maxDepth,
          maxOutputChars: options.maxOutputChars,
        },
      });

      const durationMs = Date.now() - startedAt;
      const outputText = String(await context.fs.readFile(runResult.outputPath, { encoding: "utf8" }));
      const predictedAnswer = extractPredictedAnswer(outputText);
      const correct = answersMatch(predictedAnswer, testCase.expectedAnswer);
      const summary = await readRunSummary(context.fs, runResult.auditPath);

      results.push({
        ...testCase,
        skipped: false,
        durationMs,
        runId: runResult.runId,
        predictedAnswer,
        outputSnippet: snippet(outputText, 160),
        auditPath: runResult.auditPath,
        eventsPath: runResult.eventsPath,
        recursionPath: runResult.recursionPath,
        correct,
        iterations: summary?.iterations,
        subLlmCalls: summary?.usage?.subLlmCalls,
        terminatedBy: summary?.terminatedBy,
      });

      console.log(
        `[${testCase.id}] ${correct ? "PASS" : "FAIL"} in ${durationMs}ms (type=${testCase.questionType}, expected=${quote(testCase.expectedAnswer)}, predicted=${quote(predictedAnswer)})`,
      );
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);

      results.push({
        ...testCase,
        skipped: false,
        durationMs,
        error: message,
      });

      console.error(`[${testCase.id}] ERROR after ${durationMs}ms: ${message}`);
    }
  }

  return results;
}

function buildTaskPrompt(question: string): string {
  return [
    "Read the provided long context carefully and answer the question.",
    "Return only the final answer with no explanation.",
    "If the answer is numeric, return only the number.",
    `Question: ${question}`,
  ].join("\n");
}

async function readRunSummary(
  fs: NonNullable<Workspace["filesystem"]>,
  auditPath: string,
): Promise<RlmRunSummary | null> {
  try {
    const raw = String(await fs.readFile(auditPath, { encoding: "utf8" }));
    return JSON.parse(raw) as RlmRunSummary;
  } catch {
    return null;
  }
}

function buildReport(
  options: CliOptions,
  models: { rootModelId: string; subModelId: string },
  workspaceBasePath: string,
  results: OolongCaseResult[],
): OolongReport {
  const completed = results.filter(result => !result.skipped && !result.error);
  const failed = results.filter(result => !result.skipped && Boolean(result.error));
  const skipped = results.filter(result => result.skipped);
  const correct = completed.filter(result => result.correct).length;

  const byQuestionType = aggregateByQuestionType(completed);
  const byContextBucket = aggregateByContextBucket(completed);

  return {
    generatedAt: new Date().toISOString(),
    workspaceBasePath,
    reportPath: normalizeWorkspacePath(options.reportPath),
    dataset: {
      name: options.dataset,
      config: options.config,
      split: options.split,
      offset: options.offset,
      requestedCases: options.cases,
      rowsPerRequest: options.rowsPerRequest,
      questionTypes: options.questionTypes,
      minContextChars: options.minContextChars,
      maxContextChars: options.maxContextChars,
    },
    models,
    options: {
      maxIterations: options.maxIterations,
      maxCalls: options.maxCalls,
      maxDepth: options.maxDepth,
      maxOutputChars: options.maxOutputChars,
      dryRun: options.dryRun,
    },
    totals: {
      cases: results.length,
      completed: completed.length,
      failed: failed.length,
      skipped: skipped.length,
      correct,
      accuracy: ratio(correct, completed.length),
    },
    byQuestionType,
    byContextBucket,
    results,
  };
}

function aggregateByQuestionType(results: OolongCaseResult[]): OolongReport["byQuestionType"] {
  const map = new Map<string, OolongCaseResult[]>();
  for (const result of results) {
    const bucket = map.get(result.questionType) ?? [];
    bucket.push(result);
    map.set(result.questionType, bucket);
  }

  return [...map.entries()]
    .map(([questionType, rows]) => {
      const correct = rows.filter(row => row.correct).length;
      return {
        questionType,
        completed: rows.length,
        correct,
        accuracy: ratio(correct, rows.length),
        avgDurationMs: average(rows.map(row => row.durationMs ?? 0)),
      };
    })
    .sort((a, b) => b.completed - a.completed);
}

function aggregateByContextBucket(results: OolongCaseResult[]): OolongReport["byContextBucket"] {
  const map = new Map<string, OolongCaseResult[]>();
  for (const result of results) {
    const key = contextBucket(result.contextChars);
    const bucket = map.get(key) ?? [];
    bucket.push(result);
    map.set(key, bucket);
  }

  return [...map.entries()]
    .map(([bucket, rows]) => {
      const correct = rows.filter(row => row.correct).length;
      return {
        bucket,
        completed: rows.length,
        correct,
        accuracy: ratio(correct, rows.length),
      };
    })
    .sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket));
}

function printSummary(report: OolongReport, reportPath: string): void {
  console.log("\n=== Oolong Real Benchmark ===");
  console.log(`Dataset: ${report.dataset.name} (${report.dataset.config}/${report.dataset.split})`);
  console.log(`Root model: ${report.models.rootModelId}`);
  console.log(`Sub model: ${report.models.subModelId}`);
  console.log(`Cases: ${report.totals.cases}`);
  console.log(`Completed: ${report.totals.completed}`);
  console.log(`Failed: ${report.totals.failed}`);
  console.log(`Skipped: ${report.totals.skipped}`);
  console.log(`Correct: ${report.totals.correct}`);
  console.log(`Accuracy: ${(report.totals.accuracy * 100).toFixed(2)}%`);

  if (report.byContextBucket.length > 0) {
    console.log("\nBy context bucket:");
    for (const bucket of report.byContextBucket) {
      console.log(
        `- ${bucket.bucket}: acc=${(bucket.accuracy * 100).toFixed(2)}% (${bucket.correct}/${bucket.completed})`,
      );
    }
  }

  if (report.byQuestionType.length > 0) {
    console.log("\nTop question types:");
    for (const item of report.byQuestionType.slice(0, 8)) {
      console.log(
        `- ${item.questionType}: acc=${(item.accuracy * 100).toFixed(2)}% (${item.correct}/${item.completed}), avgMs=${item.avgDurationMs.toFixed(0)}`,
      );
    }
  }

  console.log(`\nReport path (workspace): ${reportPath}`);
  console.log(`Workspace directory (host): ${report.workspaceBasePath}`);
  if (!report.options.dryRun && !report.dataset.questionTypes && report.totals.cases < report.dataset.requestedCases) {
    console.log("Note: fewer rows matched than requested. Adjust filters or increase offset.");
  }
}

function answersMatch(predictedRaw: string, expectedRaw: string): boolean {
  const predicted = normalizeAnswer(predictedRaw);
  const expected = normalizeAnswer(expectedRaw);

  if (!predicted || !expected) return false;
  if (predicted === expected) return true;

  const expectedNumber = parseNumberToken(expected);
  if (expectedNumber !== null) {
    const predictedNumber = parseNumberToken(predicted);
    if (predictedNumber !== null && predictedNumber === expectedNumber) {
      return true;
    }
  }

  if (expected.length >= 4 && predicted.includes(expected)) return true;
  return false;
}

function extractPredictedAnswer(outputText: string): string {
  const trimmed = outputText.trim();
  if (!trimmed) return "";

  const lines = trimmed
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";
  return lines[lines.length - 1] ?? "";
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/g, "")
    .toLowerCase();
}

function parseNumberToken(value: string): string | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const normalized = match[0].replace(/^(-?)0+(\d)/, "$1$2");
  return normalized;
}

function contextBucket(chars: number): string {
  if (chars < 32_000) return "<32k";
  if (chars < 64_000) return "32k-64k";
  if (chars < 128_000) return "64k-128k";
  if (chars < 256_000) return "128k-256k";
  return "256k+";
}

function bucketRank(bucket: string): number {
  switch (bucket) {
    case "<32k":
      return 0;
    case "32k-64k":
      return 1;
    case "64k-128k":
      return 2;
    case "128k-256k":
      return 3;
    default:
      return 4;
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_OPTIONS };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--cleanup") {
      options.keepWorkspace = false;
      continue;
    }

    if (arg.startsWith("--dataset=")) {
      options.dataset = parseStringValue(arg, "--dataset=");
      continue;
    }

    if (arg.startsWith("--config=")) {
      options.config = parseStringValue(arg, "--config=");
      continue;
    }

    if (arg.startsWith("--split=")) {
      options.split = parseStringValue(arg, "--split=");
      continue;
    }

    if (arg.startsWith("--offset=")) {
      options.offset = parseNonNegativeInt(arg, "--offset=");
      continue;
    }

    if (arg.startsWith("--cases=")) {
      options.cases = parsePositiveInt(arg, "--cases=");
      continue;
    }

    if (arg.startsWith("--rows-per-request=")) {
      options.rowsPerRequest = parsePositiveInt(arg, "--rows-per-request=");
      continue;
    }

    if (arg.startsWith("--question-types=")) {
      options.questionTypes = parseStringList(arg, "--question-types=");
      continue;
    }

    if (arg.startsWith("--min-context-chars=")) {
      options.minContextChars = parsePositiveInt(arg, "--min-context-chars=");
      continue;
    }

    if (arg.startsWith("--max-context-chars=")) {
      options.maxContextChars = parsePositiveInt(arg, "--max-context-chars=");
      continue;
    }

    if (arg.startsWith("--max-iterations=")) {
      options.maxIterations = parsePositiveInt(arg, "--max-iterations=");
      continue;
    }

    if (arg.startsWith("--max-calls=")) {
      options.maxCalls = parsePositiveInt(arg, "--max-calls=");
      continue;
    }

    if (arg.startsWith("--max-depth=")) {
      options.maxDepth = parsePositiveInt(arg, "--max-depth=");
      continue;
    }

    if (arg.startsWith("--max-output-chars=")) {
      options.maxOutputChars = parsePositiveInt(arg, "--max-output-chars=");
      continue;
    }

    if (arg.startsWith("--root-model=")) {
      options.rootModelId = parseStringValue(arg, "--root-model=");
      continue;
    }

    if (arg.startsWith("--sub-model=")) {
      options.subModelId = parseStringValue(arg, "--sub-model=");
      continue;
    }

    if (arg.startsWith("--report-path=")) {
      options.reportPath = normalizeWorkspacePath(parseStringValue(arg, "--report-path="));
      continue;
    }

    if (arg.startsWith("--workspace-dir=")) {
      options.workspaceDir = parseStringValue(arg, "--workspace-dir=");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseStringValue(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`Expected a value for ${prefix.slice(0, -1)}`);
  }
  return value;
}

function parseStringList(arg: string, prefix: string): string[] {
  const value = parseStringValue(arg, prefix);
  const items = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(`Expected one or more items for ${prefix.slice(0, -1)}`);
  }
  return [...new Set(items)];
}

function parsePositiveInt(arg: string, prefix: string): number {
  const value = Number.parseInt(parseStringValue(arg, prefix), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive integer for ${prefix.slice(0, -1)}`);
  }
  return value;
}

function parseNonNegativeInt(arg: string, prefix: string): number {
  const value = Number.parseInt(parseStringValue(arg, prefix), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative integer for ${prefix.slice(0, -1)}`);
  }
  return value;
}

function resolveModels(options: CliOptions): { rootModelId: string; subModelId: string } {
  const rootModelId =
    options.rootModelId ??
    process.env.RLM_ROOT_MODEL ??
    process.env.RLM_AGENT_MODEL ??
    "openrouter/minimax/minimax-m2.5";
  const subModelId = options.subModelId ?? process.env.RLM_SUB_MODEL ?? rootModelId;
  return { rootModelId, subModelId };
}

function normalizeWorkspacePath(path: string): string {
  if (!path) return "/";
  const normalized = path.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/g, "") || "/";
}

function dirname(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return normalized.slice(0, slashIndex);
}

function sanitizeId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || `row-${Date.now()}`;
}

function snippet(value: string, maxLength: number): string {
  const oneLine = value.trim().replace(/\s+/g, " ");
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength)}...`;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quote(value: string): string {
  if (!value) return '""';
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 40) return `"${singleLine}"`;
  return `"${singleLine.slice(0, 37)}..."`;
}

function printHelp(): void {
  console.log(`Oolong-real benchmark for Mastra + mastra-rlm-kit\n
Usage:
  bun run src/mastra/evaluations/oolong-real-eval.ts [options]\n
Dataset options:
  --dataset=<name>          HF dataset name (default: oolongbench/oolong-real)
  --config=<name>           HF config/subset (default: dnd)
  --split=<name>            Split name (default: validation)
  --offset=<n>              Row offset (default: 0)
  --cases=<n>               Number of benchmark rows to run (default: 20)
  --rows-per-request=<n>    Rows fetched per API call (default: 2)
  --question-types=<list>   Optional CSV filter on question_type
  --min-context-chars=<n>   Optional lower bound for context length
  --max-context-chars=<n>   Optional upper bound for context length\n
RLM options:
  --max-iterations=<n>      RLM max iterations (default: 40)
  --max-calls=<n>           RLM max subquery calls (default: 120)
  --max-depth=<n>           RLM recursion depth (default: 1)
  --max-output-chars=<n>    RLM max output chars in history (default: 10000)
  --root-model=<id>         Root model override (provider/model)
  --sub-model=<id>          Sub model override (provider/model)\n
Output options:
  --report-path=<path>      Workspace path for report JSON
                            (default: /benchmarks/oolong-real/reports/latest-report.json)
  --workspace-dir=<path>    Host directory for LocalFilesystem workspace
  --dry-run                 Build cases only, skip model execution
  --cleanup                 Remove workspace directory after run
  --help, -h                Show this help\n
Example:
  bun run src/mastra/evaluations/oolong-real-eval.ts \\
    --cases=10 \\
    --question-types=singledoc_rolls,multidoc_counts \\
    --root-model=openrouter/minimax/minimax-m2.5 \\
    --sub-model=openrouter/minimax/minimax-m2.5
`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Oolong real benchmark failed: ${message}`);
  process.exit(1);
});
