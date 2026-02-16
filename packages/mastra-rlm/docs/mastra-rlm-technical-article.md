# Building a Paper-Faithful Recursive Language Model (RLM) in Mastra

## Why this package exists

Most production LLM apps still rely on single-pass prompting or shallow tool loops. That works for simple tasks, but it often fails on high-context workflows: large documents, multi-step extraction, contradictory sources, or long-form synthesis with explicit evidence.

This package (`mastra-rlm-kit`) brings a paper-faithful Recursive Language Model loop into a Mastra-native implementation:

- iterative root-model reasoning
- persistent Python REPL state across turns
- recursive sub-queries from inside execution
- explicit terminal semantics (`FINAL(...)` and `FINAL_VAR(...)`)

The result is a practical framework for deep, structured reasoning over large source sets in real Mastra projects.

## Research references

This implementation is inspired by and aligned to:

- Original paper: [Recursive Language Models](https://arxiv.org/html/2512.24601v2)
- DSPy reference implementation: [DSPy RLM module](https://dspy.ai/api/modules/RLM/)

The goal is not to clone API names, but to preserve the core algorithmic behavior while integrating naturally with Mastra's workspace and sandbox runtime.

## Core architecture

At a high level, each run executes this loop:

1. ingest and extract source documents
2. initialize persistent REPL state (`context`, variables)
3. ask root model for next executable step
4. execute emitted `repl` code block
5. append execution feedback (`stdout`, `stderr`, variable snapshots) to history
6. repeat until termination

Termination happens when REPL code calls either:

- `FINAL(answer_string)`
- `FINAL_VAR("variable_name")`

If iteration budget is exhausted, the runner performs an extract-style fallback prompt to get the best final result from current trajectory and variables.

## Why two-model routing works well

In this project, we intentionally split models by role:

- **Root model (planner/controller):** `openrouter/moonshotai/kimi-k2.5`
- **Sub model (recursive helper):** `openrouter/minimax/minimax-m2.5`

This pattern improves cost-performance tradeoffs:

- root model handles long-horizon control and synthesis
- sub model handles many local sub-queries (`llm_query`, `llm_query_batched`)

In practice, this reduces expensive root calls while preserving quality on complex tasks.

## Mastra integration surfaces

The package exposes three entry points:

- `createRlmRunner(options)` for direct programmatic runs
- `createRlmTool(options)` for agent tool use
- `createRlmWorkflow(options)` for workflow orchestration

It also exposes a sandbox abstraction:

- `RlmSandboxAdapter`
- `defaultSandboxAdapter`

That adapter layer is what makes the package portable across Mastra projects with different sandbox setups.

## Tool integration example

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

## Workflow integration example

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

## Execution model details

### 1) Externalized context

Documents are extracted once and stored in the REPL context object. The root model does not receive raw full-doc payloads directly in every prompt turn. This keeps token pressure lower and encourages computation over state.

### 2) Runtime-safe REPL

The Python runner is intentionally constrained:

- safe builtins
- blocked unsafe eval-like primitives
- standard-library-focused import allowlist
- no dependency-install assumptions

This improves determinism and avoids common failures where models attempt package installs during execution.

### 3) Recursive query primitives

From inside code, the model can call:

- `llm_query(prompt, model=None)`
- `llm_query_batched(prompts, model=None)`

Calls are tracked and bounded by `maxCalls`; recursion depth is bounded by `maxDepth`.

### 4) Regex-first extraction helpers

To support document mining without external packages, the REPL includes:

- `regex_search(pattern, text, flags="")`
- `regex_findall(pattern, text, flags="")`

This small capability turns out to be highly effective for criteria tables, thresholds, formulas, and clause extraction from procurement/contract documents.

## Artifacts for observability and debugging

Every run writes artifacts under `/rlm/runs/<runId>/`:

- `events.jsonl`: iteration-level event stream
- `outputs/audit.json`: run summary, budgets, context size, trajectory
- `outputs/recursion-tree.json`: sub-query usage and call tree

These artifacts are critical in production. They let you answer:

- Did the model actually iterate?
- Where did it spend call budget?
- Why did it terminate?
- Was output produced by evidence-gathering or a weak early finalization?

## Practical lessons from implementation

1. **Path hygiene matters.** Never feed generated `/rlm/runs/...` artifacts back as source input. Always use original source files.
2. **Model IDs must be explicit.** Use provider/model strings; normalize placeholders like `default` early.
3. **Keep REPL predictable.** Standard-library-first execution avoids dependency drift and install loops.
4. **Split model roles.** A stronger root model plus cheaper sub model is a robust default architecture.

## Where this differs from a generic agent loop

RLM is not just "agent with tools":

- state is first-class and persistent
- code execution is central, not peripheral
- recursive calls are controlled from execution context
- termination is explicit and parseable

That combination is what gives strong performance on long-context, high-structure reasoning tasks.

## Recommended defaults for production

- Root model: `openrouter/moonshotai/kimi-k2.5`
- Sub model: `openrouter/minimax/minimax-m2.5`
- Budgets:
  - `maxIterations`: 30-60 for document-heavy tasks
  - `maxCalls`: 50-150 depending on decomposition needs
  - `maxDepth`: 1 unless nested recursion is clearly needed
  - `maxOutputChars`: size to your report format

## Closing

This package shows that paper-faithful recursive inference can be integrated into Mastra in a way that is practical, observable, and portable. The combination of RLM loop semantics, constrained REPL execution, and clear artifact traces provides a strong foundation for production-grade long-context reasoning systems.
