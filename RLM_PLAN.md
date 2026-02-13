## Mastra RLM Implementation Plan

### Scope
- Build an in-project reusable library at `src/mastra/rlm/`.
- Plug into Mastra Workspace APIs (filesystem + search) without modifying Mastra SDK internals.
- Support source paths that point to files or folders in the configured workspace filesystem.
- Support controller/scanner model IDs as configurable `provider/model` references.

### Core v1 Features
- `RlmRunner` with:
  - recursive controller loop
  - iteration/depth budgets
  - `run()` and `runStreaming()`
- Ingestion pipeline:
  - discover files from file/folder paths
  - extract text (`.txt`, `.md`, `.pdf`, `.docx`)
  - chunk + persist chunks
  - index chunks through `workspace.index()`
- Retrieval pipeline:
  - BM25 via `workspace.search()`
- Strict grounding protocol:
  - claim/evidence schema
  - quote containment checks
  - optional inference heuristic
- Verifier + revision loop
- JSONL event logging and audit output

### Parallel Scanner Strategy
- No fixed retrieval `topK` at planner level.
- Controller decides search depth and additional rounds.
- Scanner runs in parallel across chunk batches via a Mastra workflow using `.foreach(..., { concurrency })`.

### Workspace Layout
```text
/rlm/
  /runs/<runId>/
    input.json
    events.jsonl
    /sources/
    /extracted/
    /chunks/
    /outputs/
      draft.md
      audit.json
```

### Delivery Order
1. Types and event logger
2. Ingestion + chunking + indexing
3. Retrieval and scanner workflow
4. Controller adapters and structured schemas
5. Validation + audit builder
6. `RlmRunner` loop + streaming
7. Example script and unit tests (mocked model adapters)
