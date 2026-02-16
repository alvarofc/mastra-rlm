# mastra-rlm-kit

Portable, paper-faithful Recursive Language Model (RLM) package for Mastra.

## Install

```bash
npm install mastra-rlm-kit @mastra/core zod
```

## Technical Article

For a full technical write-up (architecture, loop mechanics, tradeoffs, and references to the paper and DSPy implementation), read:

- `docs/mastra-rlm-technical-article.md`

## Exports

- `createRlmRunner(options)`
- `createRlmTool(options)`
- `createRlmWorkflow(options)`
- `defaultSandboxAdapter`

## Release

From `packages/mastra-rlm`:

```bash
bun run typecheck
bun run build
bun run pack:dry
npm publish --access public
```

## CI Release

This repo includes automated publish workflow at:

- `.github/workflows/release-mastra-rlm-kit.yml`

Requirements:

- Add repository secret `NPM_TOKEN` with publish permissions.
- Push a tag in the format `mastra-rlm-kit-vX.Y.Z` matching `packages/mastra-rlm/package.json` version.

Example:

```bash
git tag mastra-rlm-kit-v0.1.0
git push origin mastra-rlm-kit-v0.1.0
```

## Quick Start

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

## Quick Start (Workflow)

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
  }
});
```

## Sandbox Adapter

If your project uses a custom sandbox shape, pass a custom adapter:

```ts
import type { RlmSandboxAdapter } from "mastra-rlm-kit";

const adapter: RlmSandboxAdapter = {
  resolveRootPath(workspace) {
    return "/custom/sandbox/root";
  },
  async executeCommand(workspace, command, args, options) {
    const result = await workspace.sandbox!.executeCommand(command, args, options);
    return {
      exitCode: result.exitCode,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  },
};
```
