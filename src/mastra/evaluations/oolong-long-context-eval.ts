import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { createRlmRunner } from "mastra-rlm-kit";
import type { RlmRunSummary } from "mastra-rlm-kit";

const NEEDLE_POSITIONS = ["start", "middle", "end"] as const;

type NeedlePosition = (typeof NEEDLE_POSITIONS)[number];

type CliOptions = {
  lengths: number[];
  positions: NeedlePosition[];
  trials: number;
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
  seed: number;
  help: boolean;
};

type OolongCase = {
  id: string;
  contextCharsTarget: number;
  contextCharsActual: number;
  needlePosition: NeedlePosition;
  expectedPasscode: string;
  sourcePath: string;
  outputPath: string;
};

type OolongCaseResult = OolongCase & {
  skipped: boolean;
  durationMs?: number;
  runId?: string;
  predictedPasscode?: string | null;
  outputSnippet?: string;
  outputPath?: string;
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

type BucketMetrics = {
  contextChars: number;
  needlePosition: NeedlePosition;
  completed: number;
  correct: number;
  accuracy: number;
  avgDurationMs: number;
  avgIterations: number;
  avgSubLlmCalls: number;
};

type OolongReport = {
  generatedAt: string;
  workspaceBasePath: string;
  reportPath: string;
  models: {
    rootModelId: string;
    subModelId: string;
  };
  options: Omit<CliOptions, "help">;
  totals: {
    cases: number;
    completed: number;
    failed: number;
    skipped: number;
    correct: number;
    accuracy: number;
  };
  byBucket: BucketMetrics[];
  results: OolongCaseResult[];
};

const WORD_BANK = [
  "archive",
  "signal",
  "matrix",
  "delta",
  "vector",
  "window",
  "ledger",
  "system",
  "policy",
  "design",
  "thread",
  "module",
  "bridge",
  "cursor",
  "buffer",
  "parser",
  "kernel",
  "bucket",
  "result",
  "context",
  "runtime",
  "memory",
  "token",
  "service",
  "channel",
  "report",
  "summary",
  "payload",
  "adapter",
  "monitor",
  "request",
  "response",
  "process",
  "routing",
  "storage",
  "compute",
  "latency",
  "quality",
  "reasoning",
  "iteration",
];

const DEFAULT_OPTIONS: CliOptions = {
  lengths: [20_000, 80_000, 160_000],
  positions: ["start", "middle", "end"],
  trials: 2,
  maxIterations: 30,
  maxCalls: 60,
  maxDepth: 1,
  maxOutputChars: 10_000,
  reportPath: "/benchmarks/oolong/reports/latest-report.json",
  keepWorkspace: true,
  dryRun: false,
  seed: 42,
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
    const cases = await createBenchmarkCases(workspaceContext.fs, options);
    const results = await runBenchmarkCases(workspaceContext, options, models, cases);
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
  const basePath = workspaceDir
    ? resolve(workspaceDir)
    : await mkdtemp(join(tmpdir(), "oolong-rlm-"));

  await mkdir(basePath, { recursive: true });

  const filesystem = new LocalFilesystem({ basePath });
  const workspace = new Workspace({
    id: "oolong-benchmark",
    name: "oolong-benchmark",
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

async function createBenchmarkCases(
  fs: NonNullable<Workspace["filesystem"]>,
  options: CliOptions,
): Promise<OolongCase[]> {
  const seedRng = createPrng(options.seed);
  const sourceRoot = "/benchmarks/oolong/sources";
  await fs.mkdir(sourceRoot, { recursive: true });

  const cases: OolongCase[] = [];

  for (const contextChars of options.lengths) {
    for (const needlePosition of options.positions) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const caseId = `len${contextChars}-${needlePosition}-t${trial}`;
        const expectedPasscode = createPasscode(seedRng, caseId);
        const sourcePath = `${sourceRoot}/${caseId}.txt`;
        const outputPath = `/benchmarks/oolong/outputs/${caseId}.md`;

        const document = generateLongContextDocument({
          contextChars,
          needlePosition,
          expectedPasscode,
          rng: createPrng(Math.floor(seedRng() * 1_000_000_000) + trial),
        });

        await fs.writeFile(sourcePath, document, {
          recursive: true,
          overwrite: true,
        });

        cases.push({
          id: caseId,
          contextCharsTarget: contextChars,
          contextCharsActual: document.length,
          needlePosition,
          expectedPasscode,
          sourcePath,
          outputPath,
        });
      }
    }
  }

  return cases;
}

async function runBenchmarkCases(
  context: WorkspaceContext,
  options: CliOptions,
  models: { rootModelId: string; subModelId: string },
  cases: OolongCase[],
): Promise<OolongCaseResult[]> {
  if (options.dryRun) {
    return cases.map(testCase => ({
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

  for (const testCase of cases) {
    const startedAt = Date.now();

    try {
      const runResult = await runner.run({
        task:
          "Find the exact value of OOLONG_PASSCODE in the source document. Return only the passcode token.",
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
      const predictedPasscode = extractPasscode(outputText);
      const outputNormalized = normalizeText(outputText);
      const expectedNormalized = normalizeText(testCase.expectedPasscode);
      const correct =
        normalizeText(predictedPasscode ?? "") === expectedNormalized ||
        outputNormalized.includes(expectedNormalized);

      const summary = await readRunSummary(context.fs, runResult.auditPath);

      results.push({
        ...testCase,
        skipped: false,
        durationMs,
        runId: runResult.runId,
        outputPath: runResult.outputPath,
        auditPath: runResult.auditPath,
        eventsPath: runResult.eventsPath,
        recursionPath: runResult.recursionPath,
        predictedPasscode,
        outputSnippet: snippet(outputText, 160),
        correct,
        iterations: summary?.iterations,
        subLlmCalls: summary?.usage?.subLlmCalls,
        terminatedBy: summary?.terminatedBy,
      });

      console.log(
        `[${testCase.id}] ${correct ? "PASS" : "FAIL"} in ${durationMs}ms (predicted=${predictedPasscode ?? "n/a"}, expected=${testCase.expectedPasscode})`,
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

  const bucketMap = new Map<string, OolongCaseResult[]>();
  for (const result of completed) {
    const key = `${result.contextCharsTarget}|${result.needlePosition}`;
    const bucket = bucketMap.get(key) ?? [];
    bucket.push(result);
    bucketMap.set(key, bucket);
  }

  const byBucket: BucketMetrics[] = [...bucketMap.entries()]
    .map(([key, bucket]) => {
      const [contextCharsRaw, needlePositionRaw] = key.split("|");
      const contextChars = Number(contextCharsRaw);
      const needlePosition = needlePositionRaw as NeedlePosition;
      const correctCount = bucket.filter(item => item.correct).length;

      return {
        contextChars,
        needlePosition,
        completed: bucket.length,
        correct: correctCount,
        accuracy: ratio(correctCount, bucket.length),
        avgDurationMs: average(bucket.map(item => item.durationMs ?? 0)),
        avgIterations: average(bucket.map(item => item.iterations ?? 0)),
        avgSubLlmCalls: average(bucket.map(item => item.subLlmCalls ?? 0)),
      };
    })
    .sort((a, b) => {
      if (a.contextChars !== b.contextChars) return a.contextChars - b.contextChars;
      return NEEDLE_POSITIONS.indexOf(a.needlePosition) - NEEDLE_POSITIONS.indexOf(b.needlePosition);
    });

  const reportOptions: Omit<CliOptions, "help"> = {
    lengths: options.lengths,
    positions: options.positions,
    trials: options.trials,
    maxIterations: options.maxIterations,
    maxCalls: options.maxCalls,
    maxDepth: options.maxDepth,
    maxOutputChars: options.maxOutputChars,
    rootModelId: options.rootModelId,
    subModelId: options.subModelId,
    reportPath: options.reportPath,
    keepWorkspace: options.keepWorkspace,
    workspaceDir: options.workspaceDir,
    dryRun: options.dryRun,
    seed: options.seed,
  };

  return {
    generatedAt: new Date().toISOString(),
    workspaceBasePath,
    reportPath: normalizeWorkspacePath(options.reportPath),
    models,
    options: reportOptions,
    totals: {
      cases: results.length,
      completed: completed.length,
      failed: failed.length,
      skipped: skipped.length,
      correct,
      accuracy: ratio(correct, completed.length),
    },
    byBucket,
    results,
  };
}

function printSummary(report: OolongReport, reportPath: string): void {
  console.log("\n=== Oolong Long-Context Benchmark ===");
  console.log(`Root model: ${report.models.rootModelId}`);
  console.log(`Sub model: ${report.models.subModelId}`);
  console.log(`Cases: ${report.totals.cases}`);
  console.log(`Completed: ${report.totals.completed}`);
  console.log(`Failed: ${report.totals.failed}`);
  console.log(`Skipped: ${report.totals.skipped}`);
  console.log(`Correct: ${report.totals.correct}`);
  console.log(`Accuracy: ${(report.totals.accuracy * 100).toFixed(2)}%`);

  if (report.byBucket.length > 0) {
    console.log("\nBy bucket:");
    for (const bucket of report.byBucket) {
      console.log(
        `- len=${bucket.contextChars}, pos=${bucket.needlePosition}, acc=${(bucket.accuracy * 100).toFixed(2)}%, avgMs=${bucket.avgDurationMs.toFixed(0)}, avgIter=${bucket.avgIterations.toFixed(2)}, avgCalls=${bucket.avgSubLlmCalls.toFixed(2)}`,
      );
    }
  }

  console.log(`\nReport path (workspace): ${reportPath}`);
  console.log(`Workspace directory (host): ${report.workspaceBasePath}`);
  if (!report.options.keepWorkspace) {
    console.log("Workspace cleanup is enabled: artifacts are removed after this run.");
  }
}

function generateLongContextDocument(input: {
  contextChars: number;
  needlePosition: NeedlePosition;
  expectedPasscode: string;
  rng: () => number;
}): string {
  const needleLine = `OOLONG_NEEDLE: The OOLONG_PASSCODE is ${input.expectedPasscode}.`;
  const spacingChars = 2;
  const availableNoiseChars = Math.max(0, input.contextChars - needleLine.length - spacingChars);
  const ratio = positionRatio(input.needlePosition);
  const leftTarget = Math.floor(availableNoiseChars * ratio);
  const rightTarget = Math.max(0, availableNoiseChars - leftTarget);

  const leftNoise = buildNoise(leftTarget, input.rng);
  const rightNoise = buildNoise(rightTarget, input.rng);

  return `${leftNoise}\n${needleLine}\n${rightNoise}`;
}

function buildNoise(targetChars: number, rng: () => number): string {
  if (targetChars <= 0) return "";

  const chunks: string[] = [];
  let currentChars = 0;

  while (currentChars < targetChars) {
    const sentence = buildSentence(rng);
    chunks.push(sentence);
    currentChars += sentence.length;
  }

  const output = chunks.join("");
  return output.length > targetChars ? output.slice(0, targetChars) : output;
}

function buildSentence(rng: () => number): string {
  const tokenCount = 10 + randomInt(rng, 16);
  const words: string[] = [];

  for (let index = 0; index < tokenCount; index += 1) {
    words.push(WORD_BANK[randomInt(rng, WORD_BANK.length)] ?? "signal");
  }

  const punctuation = rng() > 0.85 ? "?" : rng() > 0.7 ? ";" : ".";
  return `${capitalize(words[0] ?? "signal")} ${words.slice(1).join(" ")}${punctuation}\n`;
}

function createPasscode(rng: () => number, salt: string): string {
  const saltHash = hashString(salt);
  const rawA = (saltHash ^ Math.floor(rng() * 0xffff_ffff)) >>> 0;
  const rawB = Math.floor(rng() * 0xffff_ffff) >>> 0;
  const segmentA = rawA.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  const segmentB = rawB.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  return `OOLONG-${segmentA}-${segmentB}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function extractPasscode(text: string): string | null {
  const match = text.match(/OOLONG-[-A-Z0-9]+-[-A-Z0-9]+/i);
  return match?.[0] ?? null;
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

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function snippet(value: string, maxLength: number): string {
  const oneLine = value.trim().replace(/\s+/g, " ");
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength)}...`;
}

function dirname(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return normalized.slice(0, slashIndex);
}

function normalizeWorkspacePath(path: string): string {
  if (!path) return "/";
  const normalized = path.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/g, "") || "/";
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

    if (arg.startsWith("--lengths=")) {
      options.lengths = parseNumberList(arg, "--lengths=");
      continue;
    }

    if (arg.startsWith("--positions=")) {
      options.positions = parseNeedlePositions(arg, "--positions=");
      continue;
    }

    if (arg.startsWith("--trials=")) {
      options.trials = parsePositiveInt(arg, "--trials=");
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

    if (arg.startsWith("--seed=")) {
      options.seed = parsePositiveInt(arg, "--seed=");
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

function parsePositiveInt(arg: string, prefix: string): number {
  const value = Number.parseInt(parseStringValue(arg, prefix), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive integer for ${prefix.slice(0, -1)}`);
  }
  return value;
}

function parseNumberList(arg: string, prefix: string): number[] {
  const value = parseStringValue(arg, prefix);
  const numbers = value
    .split(",")
    .map(item => Number.parseInt(item.trim(), 10))
    .filter(item => Number.isFinite(item) && item > 0);

  if (numbers.length === 0) {
    throw new Error(`Expected one or more positive integers for ${prefix.slice(0, -1)}`);
  }

  return numbers;
}

function parseNeedlePositions(arg: string, prefix: string): NeedlePosition[] {
  const rawValues = parseStringValue(arg, prefix)
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (rawValues.length === 0) {
    throw new Error("Expected at least one needle position");
  }

  const parsed = rawValues.map(value => {
    if (!NEEDLE_POSITIONS.includes(value as NeedlePosition)) {
      throw new Error(`Invalid needle position '${value}'. Expected one of: ${NEEDLE_POSITIONS.join(", ")}`);
    }
    return value as NeedlePosition;
  });

  return [...new Set(parsed)];
}

function printHelp(): void {
  console.log(`Oolong-style long-context benchmark for Mastra + mastra-rlm-kit\n
Usage:
  bun run src/mastra/evaluations/oolong-long-context-eval.ts [options]\n
Options:
  --lengths=<list>          Comma-separated context sizes in chars (default: 20000,80000,160000)
  --positions=<list>        Comma-separated needle positions: start,middle,end
  --trials=<n>              Trials per (length, position) bucket (default: 2)
  --max-iterations=<n>      RLM max iterations (default: 30)
  --max-calls=<n>           RLM max subquery calls (default: 60)
  --max-depth=<n>           RLM recursion depth (default: 1)
  --max-output-chars=<n>    RLM max output chars in history (default: 10000)
  --root-model=<id>         Root model override (provider/model)
  --sub-model=<id>          Sub model override (provider/model)
  --report-path=<path>      Workspace path for report JSON (default: /benchmarks/oolong/reports/latest-report.json)
  --workspace-dir=<path>    Host directory for LocalFilesystem workspace
  --seed=<n>                Random seed for deterministic synthetic corpus (default: 42)
  --dry-run                 Generate corpus and report without model execution
  --cleanup                 Remove workspace directory after run
  --help, -h                Show this help\n
Example:
  bun run src/mastra/evaluations/oolong-long-context-eval.ts \\
    --lengths=12000,48000 \\
    --positions=start,middle,end \\
    --trials=3 \\
    --root-model=openai/gpt-4.1 \\
    --sub-model=openrouter/minimax/minimax-m2.5
`);
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function positionRatio(position: NeedlePosition): number {
  switch (position) {
    case "start":
      return 0.1;
    case "middle":
      return 0.5;
    case "end":
      return 0.9;
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Oolong benchmark failed: ${message}`);
  process.exit(1);
});
