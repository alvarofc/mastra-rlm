import type { Audit, DraftOutput, RlmRunInput, SourceRef, VerifyOutput } from '../types';

export function buildAudit(params: {
  runId: string;
  input: RlmRunInput;
  outputPath: string;
  draft: DraftOutput;
  verify: VerifyOutput | null;
  iterations: number;
  depth: number;
  chunksUsed: number;
}): Audit {
  const verdictByClaim = new Map(
    (params.verify?.verdicts ?? []).map(verdict => [verdict.claimId, verdict.status]),
  );

  return {
    runId: params.runId,
    task: params.input.task,
    sources: params.input.sources,
    finalOutputPath: params.outputPath,
    claims: params.draft.claims.map(claim => ({
      id: claim.id,
      text: claim.text,
      evidence: claim.evidence.map(evidence => ({
        docId: evidence.docId,
        chunkId: evidence.chunkId,
        quote: evidence.quote,
      })),
      status: verdictByClaim.get(claim.id) ?? 'AMBIGUOUS',
    })),
    stats: {
      iterations: params.iterations,
      depth: params.depth,
      chunksUsed: params.chunksUsed,
    },
  };
}
