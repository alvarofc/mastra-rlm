# Changelog

All notable changes to this package are documented in this file.

## 0.1.0 - 2026-02-14

- Initial public package extraction from the Mastra project.
- Added paper-faithful RLM loop with persistent Python REPL execution.
- Added recursive helper calls via `llm_query` and `llm_query_batched`.
- Added regex extraction helpers (`regex_search`, `regex_findall`) in REPL runtime.
- Added factories for integration:
  - `createRlmRunner`
  - `createRlmTool`
  - `createRlmWorkflow`
- Added pluggable sandbox adapter interface (`RlmSandboxAdapter`) and default adapter.
- Added run artifacts (`events.jsonl`, `audit.json`, `recursion-tree.json`) and docs.
