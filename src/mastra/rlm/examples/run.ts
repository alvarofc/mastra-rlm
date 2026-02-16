import { workspace } from '../../workspace/workspace';
import { RlmRunner } from '../index';

async function main(): Promise<void> {
  const [task, outputPath, ...sourcePaths] = process.argv.slice(2);

  if (!task || !outputPath || sourcePaths.length < 2) {
    throw new Error(
      'Usage: bun run src/mastra/rlm/examples/run.ts "<task>" "<outputPath>" "<sourcePath1>" "<sourcePath2>" [moreSources...]',
    );
  }

  const rootModel =
    process.env.RLM_ROOT_MODEL ?? 'groq/llama-3.3-70b-versatile';
  const subModel = process.env.RLM_SUB_MODEL ?? rootModel;

  const runner = new RlmRunner({
    workspace,
    rootModel: { id: rootModel },
    subModel: { id: subModel },
  });

  const result = await runner.run({
    task,
    sources: sourcePaths.map(path => ({ path })),
    output: {
      format: 'md',
      path: outputPath,
    },
    budgets: {
      maxIterations: 30,
      maxCalls: 50,
      maxDepth: 1,
      maxOutputChars: 10_000,
    },
  });

  console.log(`runId: ${result.runId}`);
  console.log(`output: ${result.outputPath}`);
  console.log(`audit: ${result.auditPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
