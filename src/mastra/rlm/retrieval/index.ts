import type { Workspace } from '@mastra/core/workspace';

import type { Chunk } from '../types';

type RetrieveInput = {
  workspace: Workspace;
  runId: string;
  queries: string[];
  topK: number;
};

export async function retrieveChunks({ workspace, runId, queries, topK }: RetrieveInput): Promise<Chunk[]> {
  const fs = workspace.filesystem;
  if (!fs) {
    throw new Error('Workspace filesystem is not configured');
  }

  const queryList = queries.map(query => query.trim()).filter(Boolean);
  if (queryList.length === 0) {
    return [];
  }

  const resultsByPath = new Map<string, number>();

  for (const query of queryList) {
    const results = await workspace.search(query, {
      mode: 'bm25',
      topK,
    });

    for (const result of results) {
      if (!result.id.startsWith(`/rlm/runs/${runId}/chunks/`)) continue;
      const prev = resultsByPath.get(result.id) ?? 0;
      resultsByPath.set(result.id, Math.max(prev, result.score));
    }
  }

  const sortedPaths = [...resultsByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);

  const chunks: Chunk[] = [];
  for (const path of sortedPaths) {
    const payload = await fs.readFile(path, { encoding: 'utf8' });
    const chunk = JSON.parse(payload as string) as Chunk;
    chunks.push(chunk);
  }

  return chunks;
}
