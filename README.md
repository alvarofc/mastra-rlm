# mastra-rlm

`mastra-rlm` is a Mastra project plus a reusable package (`mastra-rlm-kit`) for running a paper-faithful Recursive Language Model (RLM) loop with:

- a root model that writes Python REPL steps
- optional recursive sub-queries (`llm_query`, `llm_query_batched`)
- full run artifacts (output, trajectory, events, recursion tree)

If you are new to this repo, start with the Quickstart below and run one benchmark command first.

## Quickstart

1) Install dependencies:

```bash
bun install
```

2) Build the reusable package once:

```bash
bun run build:pkg:rlm
```

3) Set model credentials (example for OpenRouter):

```bash
export OPENROUTER_API_KEY=...
```

4) Run a small benchmark smoke test:

```bash
bun run eval:oolong --cases=1 --rows-per-request=1
```

5) Open Mastra Studio (optional):

```bash
bun run dev
```

Studio runs at `http://localhost:4111`.

## What is in this repo

- App integration: `src/mastra/*`
- Reusable package source: `packages/mastra-rlm/*`
- Real benchmark runner: `src/mastra/evaluations/oolong-real-eval.ts`
- Synthetic benchmark runner: `src/mastra/evaluations/oolong-long-context-eval.ts`

The package exports:

- `createRlmRunner`
- `createRlmTool`
- `createRlmWorkflow`
- `defaultSandboxAdapter`

## Core scripts

- `bun run dev` - start Mastra Studio
- `bun run build` - build Mastra app
- `bun run build:pkg:rlm` - build `mastra-rlm-kit`
- `bun run eval:oolong` - run real Oolong benchmark
- `bun run eval:oolong:synthetic` - run synthetic long-context benchmark

## RLM usage in Studio

This project exposes RLM in two ways:

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

## Model configuration

Global defaults via env vars:

```bash
RLM_AGENT_MODEL=openrouter/minimax/minimax-m2.5
RLM_ROOT_MODEL=openrouter/moonshotai/kimi-k2.5
RLM_SUB_MODEL=openrouter/minimax/minimax-m2.5
```

Per-run override is also supported via workflow/tool input (`rootModelId`, `subModelId`).

## Benchmark policy (strict mode)

For strict benchmark runs, this repo does not rewrite benchmark questions or labels. It only:

- reads dataset rows
- runs the RLM loop
- scores predicted output against provided expected answers

This keeps comparisons reproducible and avoids benchmark prompt tampering.

## Oolong benchmark

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

## Latest real-dataset result

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

`/tmp/oolong-real-kimi-main-m25-sub/benchmarks/oolong-real/reports/kimi-main-m25-sub.json`

## References

- Recursive Language Models paper: [Recursive Language Models (Zhang et al., 2025)](https://arxiv.org/abs/2512.24601)
- DSPy: [dspy.ai](https://dspy.ai/) and [github.com/stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)
- Practical article: [Going Beyond the Context Window: Recursive Language Models in Action](https://towardsdatascience.com/going-beyond-the-context-window-recursive-language-models-in-action/)

## License

MIT. See `LICENSE`.
