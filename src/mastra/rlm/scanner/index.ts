import type { Chunk, ScanHit, ScannerAdapter } from '../types';
import { runScannerWorkflow } from '../workflows/scanner-workflow';

export function createScannerAdapter(modelId: string): ScannerAdapter {
  return {
    async scan(input): Promise<ScanHit[]> {
      const batches = toBatches(input.chunks, input.batchSize).map(batch => ({
        task: input.task,
        queries: input.queries,
        focusQuestions: input.queries,
        chunks: batch.map(chunk => ({
          chunkId: chunk.chunkId,
          docId: chunk.docId,
          text: chunk.text,
        })),
      }));

      return runScannerWorkflow({
        workflowId: `rlm-scanner-${input.runId}-${input.iteration}-${Date.now()}`,
        modelId,
        batches,
        concurrency: input.concurrency,
      });
    },
  };
}

function toBatches(chunks: Chunk[], batchSize: number): Chunk[][] {
  const result: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    result.push(chunks.slice(i, i + batchSize));
  }
  return result;
}
