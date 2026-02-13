import type { Chunk, DraftOutput } from '../types';

export type ValidationIssue = {
  claimId: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export function validateDraft(params: {
  draft: DraftOutput;
  chunkById: Map<string, Chunk>;
  requireQuotes: boolean;
  allowInference: boolean;
}): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const claim of params.draft.claims) {
    if (params.requireQuotes && claim.evidence.length === 0) {
      issues.push({
        claimId: claim.id,
        message: 'Claim has no evidence while quotes are required.',
      });
      continue;
    }

    const evidenceTexts: string[] = [];

    for (const evidence of claim.evidence) {
      const chunk = params.chunkById.get(evidence.chunkId);
      if (!chunk) {
        issues.push({
          claimId: claim.id,
          message: `Referenced chunk not found: ${evidence.chunkId}`,
        });
        continue;
      }

      if (chunk.docId !== evidence.docId) {
        issues.push({
          claimId: claim.id,
          message: `Evidence doc mismatch for chunk ${evidence.chunkId}: expected ${chunk.docId}, got ${evidence.docId}`,
        });
      }

      const quoteFound = containsNormalized(chunk.text, evidence.quote);
      if (!quoteFound) {
        issues.push({
          claimId: claim.id,
          message: `Evidence quote not found verbatim in chunk ${evidence.chunkId}`,
        });
      }

      evidenceTexts.push(evidence.quote);
    }

    if (!params.allowInference && !isLexicallyGrounded(claim.text, evidenceTexts)) {
      issues.push({
        claimId: claim.id,
        message: 'Claim appears weakly grounded by lexical overlap heuristic.',
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function containsNormalized(text: string, quote: string): boolean {
  const normalizedText = normalizeSpaces(text).toLowerCase();
  const normalizedQuote = normalizeSpaces(quote).toLowerCase();
  if (!normalizedQuote) return false;
  return normalizedText.includes(normalizedQuote);
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isLexicallyGrounded(claimText: string, quotes: string[]): boolean {
  if (quotes.length === 0) return false;

  const claimTokens = tokenize(claimText);
  if (claimTokens.size === 0) return false;

  const quoteTokens = new Set<string>();
  for (const quote of quotes) {
    for (const token of tokenize(quote)) {
      quoteTokens.add(token);
    }
  }

  if (quoteTokens.size === 0) return false;

  let overlap = 0;
  for (const token of claimTokens) {
    if (quoteTokens.has(token)) overlap += 1;
  }

  const ratio = overlap / claimTokens.size;
  return ratio >= 0.2;
}

function tokenize(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4);

  return new Set(tokens);
}
