import type { Chunk } from '../types';

const DEFAULT_CHUNK_SIZE_CHARS = 5000;
const DEFAULT_OVERLAP_RATIO = 0.12;

export function chunkText(params: {
  docId: string;
  sourcePath: string;
  text: string;
  chunkSizeChars?: number;
  overlapRatio?: number;
}): Chunk[] {
  const chunkSizeChars = params.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS;
  const overlapRatio = params.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  const overlapChars = Math.floor(chunkSizeChars * overlapRatio);

  const text = normalizeText(params.text);
  if (!text) return [];

  const chunks: Chunk[] = [];

  let offsetStart = 0;
  let index = 0;
  while (offsetStart < text.length) {
    const softEnd = Math.min(offsetStart + chunkSizeChars, text.length);
    const chunkEnd = findSplitBoundary(text, offsetStart, softEnd);
    const chunkTextValue = text.slice(offsetStart, chunkEnd).trim();

    if (chunkTextValue.length > 0) {
      const chunkId = `${params.docId}-chunk-${String(index).padStart(4, '0')}`;
      chunks.push({
        chunkId,
        docId: params.docId,
        sourcePath: params.sourcePath,
        text: chunkTextValue,
        meta: {
          offsetStart,
          offsetEnd: chunkEnd,
        },
      });
      index += 1;
    }

    if (chunkEnd >= text.length) break;

    offsetStart = Math.max(0, chunkEnd - overlapChars);
    if (offsetStart >= chunkEnd) {
      offsetStart = chunkEnd;
    }
  }

  return chunks;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ').trim();
}

function findSplitBoundary(text: string, start: number, end: number): number {
  if (end >= text.length) return text.length;

  const lookback = text.slice(start, end);
  const paragraphSplit = lookback.lastIndexOf('\n\n');
  if (paragraphSplit > 0) {
    return start + paragraphSplit + 2;
  }

  const sentenceMatches = ['. ', '! ', '? ', '\n'];
  let best = -1;
  for (const marker of sentenceMatches) {
    const idx = lookback.lastIndexOf(marker);
    if (idx > best) best = idx;
  }

  if (best > 0) {
    return start + best + 1;
  }

  return end;
}
