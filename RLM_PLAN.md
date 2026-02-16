## Mastra RLM Implementation Plan

### Scope
- Build an in-project reusable library at `src/mastra/rlm/`.
- Plug into Mastra Workspace APIs (filesystem + sandbox) without modifying Mastra SDK internals.
- Support source paths that point to files or folders in the configured workspace filesystem.
- Support root/sub model IDs as configurable `provider/model` references.

### Core Features (Pure Loop)
- `RlmRunner` with:
  - paper-faithful iterative root loop
  - iteration/call/depth budgets
  - `run()` and `runStreaming()`
- Ingestion pipeline:
  - discover files from file/folder paths
  - extract text (`.txt`, `.md`, `.pdf`, `.docx`)
  - build externalized REPL context payload
- Persistent Python REPL execution:
  - ` ```repl ` code blocks
  - persistent variables across turns
  - `llm_query` / `llm_query_batched` tools for sub-LLM calls
  - terminal `FINAL(...)` / `FINAL_VAR(...)`
- JSONL events + trajectory/audit artifacts

### Workspace Layout
```text
/rlm/
  /runs/<runId>/
    input.json
    events.jsonl
    /sources/
    /extracted/
    /repl/
      context.json
      state.pkl
      runner.py
    /outputs/
      final.(md|json)
      audit.json
      recursion-tree.json
```

### Explicitly Removed
- Controller action graph (`SEARCH/SCAN/DRAFT/VERIFY/REVISE/FINALIZE`)
- Retrieval/scanner orchestration pipeline
- Grounding validation and contradiction policy loop
