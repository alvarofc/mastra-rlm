import type { ControllerContext } from '../types';

export function controllerSystemPrompt(): string {
  return [
    'You are the controller for a recursive language model loop.',
    'Goal: produce grounded output from provided source chunks only.',
    'Hard rules:',
    '- Every factual claim must include evidence references.',
    '- Evidence quotes must be verbatim snippets from chunks.',
    '- If information is missing, explicitly say it is not specified in provided documents.',
    '- Prefer SEARCH and SCAN when evidence is weak.',
    '- Only FINALIZE when confidence is high and verification is acceptable.',
  ].join('\n');
}

export function buildActionPrompt(context: ControllerContext): string {
  return [
    'Decide the next action in the RLM loop.',
    `Task: ${context.input.task}`,
    `Iteration: ${context.iteration}`,
    `Depth: ${context.depth}`,
    `Recent queries: ${JSON.stringify(context.recentQueries)}`,
    `Retrieved chunks: ${context.retrievedChunks.length}`,
    `Draft exists: ${context.draft ? 'yes' : 'no'}`,
    `Verify exists: ${context.verify ? 'yes' : 'no'}`,
    context.verify ? `Last verify overall: ${context.verify.overall}` : 'Last verify overall: n/a',
    '',
    'Return one action among SEARCH, SCAN, DRAFT, VERIFY, REVISE, FINALIZE.',
    'Use SEARCH when you need more evidence.',
    'Use SCAN to narrow many retrieved chunks.',
    'Use DRAFT to produce structured claims.',
    'Use VERIFY to classify claims.',
    'Use REVISE to remove unsupported claims.',
    'Use FINALIZE only if done.',
  ].join('\n');
}

export function buildDraftPrompt(context: ControllerContext): string {
  const chunkPreview = context.retrievedChunks.slice(0, 60).map(chunk => ({
    chunkId: chunk.chunkId,
    docId: chunk.docId,
    sourcePath: chunk.sourcePath,
    text: clip(chunk.text, 1800),
  }));

  return [
    'Generate a grounded draft in JSON.',
    `Task: ${context.input.task}`,
    `Output format: ${context.input.output.format}`,
    `Require quotes: ${String(context.input.grounding?.requireQuotes ?? true)}`,
    `Allow inference: ${String(context.input.grounding?.allowInference ?? false)}`,
    '',
    'Use only these chunks:',
    JSON.stringify(chunkPreview, null, 2),
    '',
    'Every claim must be atomic and include evidence with docId, chunkId, quote.',
    'If a requested topic is not in evidence, include "Not specified in the provided documents" in text.',
  ].join('\n');
}

export function buildVerifyPrompt(context: ControllerContext): string {
  const chunkMap = Object.fromEntries(
    context.retrievedChunks.slice(0, 80).map(chunk => [
      chunk.chunkId,
      {
        docId: chunk.docId,
        text: clip(chunk.text, 1200),
      },
    ]),
  );

  return [
    'Verify each draft claim against available chunk text.',
    `Task: ${context.input.task}`,
    'Classify each claim as SUPPORTED, UNSUPPORTED, CONTRADICTED, or AMBIGUOUS.',
    'If unsupported, include neededQueries for missing evidence.',
    'If contradictions exist, set overall to CONTRADICTION.',
    'If more evidence is required, set overall to NEEDS_MORE_EVIDENCE.',
    '',
    'Draft:',
    JSON.stringify(context.draft, null, 2),
    '',
    'Chunk references:',
    JSON.stringify(chunkMap, null, 2),
  ].join('\n');
}

export function buildRevisePrompt(context: ControllerContext): string {
  return [
    'Revise the draft to remove or rewrite weak claims.',
    `Task: ${context.input.task}`,
    `Verify summary: ${context.verify?.overall ?? 'n/a'}`,
    'Keep supported claims and their evidence.',
    'Remove unsupported claims unless marked as unresolved.',
    'If contradictions exist and policy is report, include a conflict note with both sides.',
    '',
    'Current draft:',
    JSON.stringify(context.draft, null, 2),
    '',
    'Verify details:',
    JSON.stringify(context.verify, null, 2),
  ].join('\n');
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
