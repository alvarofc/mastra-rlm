import { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { scanBatchInputSchema, scanBatchOutputSchema, scanHitSchema } from '../scanner/schemas';
import type { ScanHit } from '../types';

type ScannerWorkflowInput = {
  workflowId: string;
  modelId: string;
  batches: Array<z.infer<typeof scanBatchInputSchema>>;
  concurrency: number;
};

export async function runScannerWorkflow({
  workflowId,
  modelId,
  batches,
  concurrency,
}: ScannerWorkflowInput): Promise<ScanHit[]> {
  if (batches.length === 0) return [];

  const scannerAgent = new Agent({
    id: `${workflowId}-agent`,
    name: 'RLM Scanner',
    model: modelId,
    instructions: [
      'You are a scanner model.',
      'You do not answer the user task directly.',
      'Only extract relevant verbatim snippets from chunk text for the task/questions.',
      'Return precise snippets and avoid fabrication.',
    ].join('\n'),
  });

  const scanBatchStep = createStep({
    id: `${workflowId}-scan-batch`,
    inputSchema: scanBatchInputSchema,
    outputSchema: scanBatchOutputSchema,
    execute: async ({ inputData }) => {
      const prompt = [
        `Task: ${inputData.task}`,
        `Queries: ${JSON.stringify(inputData.queries)}`,
        `Focus questions: ${JSON.stringify(inputData.focusQuestions)}`,
        'Chunks:',
        JSON.stringify(
          inputData.chunks.map(chunk => ({
            chunkId: chunk.chunkId,
            docId: chunk.docId,
            text: chunk.text.slice(0, 2000),
          })),
          null,
          2,
        ),
        'Return hits with verbatim snippet quotes.',
      ].join('\n');

      const result = await scannerAgent.generate(prompt, {
        structuredOutput: {
          schema: scanBatchOutputSchema,
          jsonPromptInjection: true,
        },
      });

      return scanBatchOutputSchema.parse(result.object);
    },
  });

  const workflow = createWorkflow({
    id: workflowId,
    inputSchema: z.array(scanBatchInputSchema),
    outputSchema: z.array(scanBatchOutputSchema),
  }).foreach(scanBatchStep, {
    concurrency,
  });

  workflow.commit();

  const run = await workflow.createRun();
  const result = await run.start({ inputData: batches });

  if (result.status !== 'success') {
    throw new Error(`Scanner workflow failed with status ${result.status}`);
  }

  const hits = result.result.flatMap(batch => batch.hits);
  return dedupeHits(hits);
}

function dedupeHits(hits: ScanHit[]): ScanHit[] {
  const seen = new Set<string>();
  const unique: ScanHit[] = [];

  for (const hit of hits) {
    const key = `${hit.chunkId}::${hit.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(scanHitSchema.parse(hit));
  }

  return unique;
}
