# mastra-rlm

Welcome to your new [Mastra](https://mastra.ai/) project! We're excited to see what you'll build.

## Getting Started

Start the development server:

```shell
bun run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/getting-started/studio). It provides an interactive UI for building and testing your agents, along with a REST API that exposes your Mastra application as a local service. This lets you start building without worrying about integration right away.

You can start editing files inside the `src/mastra` directory. The development server will automatically reload whenever you make changes.

## RLM in Studio UI

This project includes an RLM runner integrated into Mastra Studio:

- **Agent path:** Use `rlm-agent` in the chat UI and ask it to run grounded generation from workspace files/folders.
- **Workflow path:** Run `rlm-workflow` directly from the Workflows tab with structured input.

Example workflow input:

```json
{
  "task": "Compare both policy documents and produce a grounded summary",
  "sources": [
    { "path": "/docs/policy-a.pdf" },
    { "path": "/docs/policy-b.pdf" }
  ],
  "output": {
    "format": "md",
    "path": "/rlm/outputs/policy-comparison.md"
  }
}
```

Outputs are written to workspace paths and each run emits an audit file with claim-to-evidence mapping.

### Set smart + small models

You can configure model split in two ways:

1. Global defaults via env:

```bash
OPENROUTER_API_KEY=...
RLM_AGENT_MODEL=openrouter/minimax/minimax-m2.5
RLM_CONTROLLER_MODEL=openai/gpt-4.1
RLM_SCANNER_MODEL=openai/gpt-4.1-mini
```

`RLM_AGENT_MODEL` controls the default chat model used by `rlm-agent` in Studio.

2. Per-run override in `rlm-workflow` input:

```json
{
  "controllerModelId": "openai/gpt-4.1",
  "scannerModelId": "openai/gpt-4.1-mini"
}
```

You can also override per run when using `run_rlm` through `rlm-agent` by passing `controllerModelId` and `scannerModelId`.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). Your bootstrapped project includes example code for [agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/using-tools), [workflows](https://mastra.ai/docs/workflows/overview), [scorers](https://mastra.ai/docs/evals/overview), and [observability](https://mastra.ai/docs/observability/overview).

If you're new to AI agents, check out our [course](https://mastra.ai/course) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy on Mastra Cloud

[Mastra Cloud](https://cloud.mastra.ai/) gives you a serverless agent environment with atomic deployments. Access your agents from anywhere and monitor performance. Make sure they don't go off the rails with evals and tracing.

Check out the [deployment guide](https://mastra.ai/docs/deployment/overview) for more details.
