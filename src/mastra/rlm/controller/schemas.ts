import { z } from 'zod';

export const controllerActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SEARCH'),
    queries: z.array(z.string()).min(1),
    reasoning: z.string(),
  }),
  z.object({
    action: z.literal('SCAN'),
    focusQuestions: z.array(z.string()).min(1),
    reasoning: z.string(),
  }),
  z.object({
    action: z.literal('DRAFT'),
    reasoning: z.string(),
  }),
  z.object({
    action: z.literal('VERIFY'),
    reasoning: z.string(),
  }),
  z.object({
    action: z.literal('REVISE'),
    issues: z.array(z.string()).min(1),
    reasoning: z.string(),
  }),
  z.object({
    action: z.literal('FINALIZE'),
    reasoning: z.string(),
  }),
]);

export const draftOutputSchema = z.object({
  sectionTitle: z.string().optional(),
  text: z.string(),
  claims: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      evidence: z.array(
        z.object({
          docId: z.string(),
          chunkId: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

export const verifyOutputSchema = z.object({
  verdicts: z.array(
    z.object({
      claimId: z.string(),
      status: z.enum(['SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED', 'AMBIGUOUS']),
      notes: z.string(),
      neededQueries: z.array(z.string()).optional(),
    }),
  ),
  overall: z.enum(['OK', 'NEEDS_MORE_EVIDENCE', 'CONTRADICTION']),
});
