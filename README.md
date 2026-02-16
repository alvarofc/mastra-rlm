# mastra-rlm

`mastra-rlm` is a repository centered on the reusable package **`mastra-rlm-kit`**, with a Mastra app in `src/mastra` as a working example and benchmark harness.

## Read this first

If you are new to the project, follow this order:

1. This README (package-first overview + commands)
2. Package README: [`packages/mastra-rlm/README.md`](packages/mastra-rlm/README.md)
3. Technical article: [`packages/mastra-rlm/docs/mastra-rlm-technical-article.md`](packages/mastra-rlm/docs/mastra-rlm-technical-article.md)

The package README and technical article are the deepest docs; this root README is the central index so information is not scattered.

## Package first: `mastra-rlm-kit`

`mastra-rlm-kit` is a portable, paper-faithful Recursive Language Model loop for Mastra with:

- a root model that writes Python REPL steps
- optional recursive sub-queries (`llm_query`, `llm_query_batched`)
- deterministic run artifacts (output, audit, events, recursion tree)

### Install

```bash
npm install mastra-rlm-kit @mastra/core zod
```

### Exports

- `createRlmRunner(options)`
- `createRlmTool(options)`
- `createRlmWorkflow(options)`
- `defaultSandboxAdapter`

### Quick start (tool)

```ts
import { createRlmTool } from "mastra-rlm-kit";
import { workspace } from "./workspace";

export const runRlmTool = createRlmTool({
  workspace,
  defaults: {
    rootModelId: "openrouter/moonshotai/kimi-k2.5",
    subModelId: "openrouter/minimax/minimax-m2.5",
    budgets: {
      maxIterations: 30,
      maxCalls: 50,
      maxDepth: 1,
      maxOutputChars: 10000,
    },
  },
});
```

### Quick start (workflow)

```ts
import { createRlmWorkflow } from "mastra-rlm-kit";
import { workspace } from "./workspace";

export const rlmWorkflow = createRlmWorkflow({
  workspace,
  models: {
    root: { id: "openrouter/moonshotai/kimi-k2.5" },
    sub: { id: "openrouter/minimax/minimax-m2.5" },
  },
  defaults: {
    budgets: {
      maxIterations: 30,
      maxCalls: 50,
      maxDepth: 1,
      maxOutputChars: 10000,
    },
  },
});
```

### Release (package)

From `packages/mastra-rlm`:

```bash
bun run typecheck
bun run build
bun run pack:dry
npm publish --access public
```

This repo also includes CI publishing via:

- `.github/workflows/release-mastra-rlm-kit.yml`

Tag format:

- `mastra-rlm-kit-vX.Y.Z` (must match `packages/mastra-rlm/package.json` version)

## Example app in this repo (`src/mastra`)

The app demonstrates package integration in a real Mastra project.

### Setup and run

```bash
bun install
bun run build:pkg:rlm
bun run dev
```

Studio runs at `http://localhost:4111`.

### Core scripts

- `bun run dev` - start Mastra Studio
- `bun run build` - build Mastra app
- `bun run build:pkg:rlm` - build `mastra-rlm-kit`
- `bun run eval:oolong` - run real Oolong benchmark
- `bun run eval:oolong:synthetic` - run synthetic long-context benchmark

### RLM integration paths

- Agent path: `rlm-agent` in Studio chat
- Workflow path: `rlm-workflow` in Studio workflows

Example workflow input:

```json
{
  "task": "Compare both policy documents and produce a final answer",
  "sources": [
    { "path": "/docs/policy-a.pdf" },
    { "path": "/docs/policy-b.pdf" }
  ],
  "output": {
    "format": "md",
    "path": "/rlm/outputs/policy-comparison.md"
  },
  "budgets": {
    "maxIterations": 30,
    "maxCalls": 50,
    "maxDepth": 1,
    "maxOutputChars": 10000
  }
}
```

Run result paths include:

- `outputPath` - final answer file
- `auditPath` - run summary JSON
- `eventsPath` - JSONL event stream
- `recursionPath` - recursive call tree summary

### Model configuration

Global defaults via env vars:

```bash
RLM_AGENT_MODEL=openrouter/minimax/minimax-m2.5
RLM_ROOT_MODEL=openrouter/moonshotai/kimi-k2.5
RLM_SUB_MODEL=openrouter/minimax/minimax-m2.5
```

Per-run overrides are supported via `rootModelId` and `subModelId` in workflow/tool input.

## Benchmarks

### Strict benchmark policy

For strict benchmark runs, this repo does not rewrite benchmark questions or labels. It only:

- reads dataset rows
- runs the RLM loop
- scores predicted output against provided expected answers

This keeps comparisons reproducible and avoids benchmark prompt tampering.

### Oolong benchmark commands

Real dataset (`oolongbench/oolong-real`):

```bash
bun run eval:oolong
```

Useful options:

```bash
bun run eval:oolong --help
bun run eval:oolong --cases=10 --question-types=singledoc_rolls,multidoc_counts
```

Synthetic needle-in-a-haystack run:

```bash
bun run eval:oolong:synthetic
```

### Latest real-dataset result

Command:

```bash
bun run eval:oolong --dataset=oolongbench/oolong-real --config=dnd --split=validation --offset=17 --cases=20 --rows-per-request=1 --max-iterations=60 --max-calls=180 --max-depth=2 --max-output-chars=20000 --root-model=openrouter/moonshotai/kimi-k2.5 --sub-model=openrouter/minimax/minimax-m2.5 --workspace-dir="/tmp/oolong-real-kimi-main-m25-sub" --report-path=/benchmarks/oolong-real/reports/kimi-main-m25-sub.json
```

Summary:

- Cases: 20
- Completed: 20 (failed: 0, skipped: 0)
- Accuracy: 20.0% (4/20)
- Slice: `singledoc_spells`
- Avg duration: 76.0s (median: 68.3s)
- Avg sub-LLM calls: 7.7 (max: 15)

Result interpretation:

- Primary score is exact-match accuracy (official metric).
- Many failures are near misses (for example numeric off-by-one, partially correct ordered lists, or semantically close but non-canonical spell names).
- Near misses are useful diagnostics, but they are not counted as correct in benchmark reporting.

Report path:

- `/tmp/oolong-real-kimi-main-m25-sub/benchmarks/oolong-real/reports/kimi-main-m25-sub.json`

Note on `/tmp` paths:

- `/tmp/...` is local to the machine that ran the benchmark and is not stored in this repository.
- Use your own `--workspace-dir` to choose where artifacts are written.
- If `--workspace-dir` is omitted, the runner creates a temporary directory automatically.

## References

- Recursive Language Models paper: [Recursive Language Models (Zhang et al., 2025)](https://arxiv.org/abs/2512.24601)
- DSPy: [dspy.ai](https://dspy.ai/) and [github.com/stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)
- Practical article: [Going Beyond the Context Window: Recursive Language Models in Action](https://towardsdatascience.com/going-beyond-the-context-window-recursive-language-models-in-action/)

## License

MIT. See `LICENSE`.
