import { workspace } from '../../workspace/workspace';
import { RlmRunner } from '../index';

async function main(): Promise<void> {
  const [task, outputPath, ...sourcePaths] = process.argv.slice(2);

  if (!task || !outputPath || sourcePaths.length < 2) {
    throw new Error(
      'Usage: bun run src/mastra/rlm/examples/run.ts "<task>" "<outputPath>" "<sourcePath1>" "<sourcePath2>" [moreSources...]',
    );
  }

  const controllerModel = process.env.RLM_CONTROLLER_MODEL ?? 'groq/llama-3.3-70b-versatile';
  const scannerModel = process.env.RLM_SCANNER_MODEL;

  const runner = new RlmRunner({
    workspace,
    controllerModel: { id: controllerModel },
    scannerModel: scannerModel ? { id: scannerModel } : undefined,
  });

  const result = await runner.run({
    task,
    taskType: 'synthesis',
    sources: sourcePaths.map(path => ({ path })),
    output: {
      format: 'md',
      path: outputPath,
    },
    grounding: {
      requireQuotes: true,
      allowInference: false,
      allowSynthesis: true,
    },
    budgets: {
      maxDepth: 5,
      maxIterations: 200,
      scannerBatchSize: 20,
      scannerConcurrency: 4,
      searchTopK: 1000,
    },
    contradictionPolicy: 'report',
    outputCitations: 'both',
  });

  console.log(`runId: ${result.runId}`);
  console.log(`output: ${result.outputPath}`);
  console.log(`audit: ${result.auditPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
