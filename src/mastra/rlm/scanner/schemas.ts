import { z } from 'zod';

export const scanHitSchema = z.object({
  chunkId: z.string(),
  docId: z.string(),
  snippet: z.string(),
  label: z.enum(['definition', 'requirement', 'exception', 'deadline', 'other']),
  reason: z.string(),
});

export const scanBatchChunkSchema = z.object({
  chunkId: z.string(),
  docId: z.string(),
  text: z.string(),
});

export const scanBatchInputSchema = z.object({
  task: z.string(),
  queries: z.array(z.string()),
  focusQuestions: z.array(z.string()),
  chunks: z.array(scanBatchChunkSchema),
});

export const scanBatchOutputSchema = z.object({
  hits: z.array(scanHitSchema),
});
