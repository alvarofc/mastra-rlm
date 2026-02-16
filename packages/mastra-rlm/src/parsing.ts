import type { FinalSignal } from './types';

export function findReplCodeBlocks(text: string): string[] {
  const pattern = /```(?:repl|python)\s*\n([\s\S]*?)\n```/g;
  const matches: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const code = match[1]?.trim();
    if (code) matches.push(code);
  }

  if (matches.length === 0) {
    const structuredCode = extractStructuredCodeField(text);
    if (structuredCode) {
      matches.push(structuredCode);
    }
  }

  return matches;
}

function extractStructuredCodeField(text: string): string | null {
  const marker = /\[\[\s*##\s*code\s*##\s*\]\]\s*([\s\S]*?)(?=\[\[\s*##\s*completed\s*##\s*\]\]|$)/i;
  const match = text.match(marker);
  const payload = match?.[1]?.trim();
  if (!payload) return null;

  const fenced = payload.match(/```(?:repl|python)?\s*\n([\s\S]*?)\n```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  return payload;
}

export function findFinalSignal(text: string): FinalSignal | null {
  const finalVarPattern = /^\s*FINAL_VAR\((.*?)\)/ms;
  const finalVarMatch = text.match(finalVarPattern);
  if (finalVarMatch) {
    const raw = finalVarMatch[1] ?? '';
    const varName = raw.trim().replace(/^['"]|['"]$/g, '');
    return { type: 'FINAL_VAR', varName };
  }

  const finalPattern = /^\s*FINAL\((.*)\)\s*$/ms;
  const finalMatch = text.match(finalPattern);
  if (finalMatch) {
    return {
      type: 'FINAL',
      answer: (finalMatch[1] ?? '').trim(),
    };
  }

  return null;
}
