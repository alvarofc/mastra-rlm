import type { Workspace } from '@mastra/core/workspace';

import { basename, dirname, extension, joinWorkspacePath, normalizePath } from '../path-utils';
import type { IngestionResult, RlmEvent, SourceRef } from '../types';
import { chunkText } from './chunk';
import { extractText, isSupportedForExtraction } from './extract';

type IngestInput = {
  workspace: Workspace;
  runId: string;
  sources: SourceRef[];
  emit: (event: RlmEvent) => Promise<void>;
};

export async function ingestSources({ workspace, runId, sources, emit }: IngestInput): Promise<IngestionResult> {
  const fs = workspace.filesystem;
  if (!fs) {
    throw new Error('Workspace filesystem is not configured');
  }

  await emit({ type: 'ingest.start', sources });

  const runRoot = `/rlm/runs/${runId}`;
  const sourcesDir = joinWorkspacePath(runRoot, 'sources');
  const extractedDir = joinWorkspacePath(runRoot, 'extracted');
  const chunksDir = joinWorkspacePath(runRoot, 'chunks');

  await fs.mkdir(sourcesDir, { recursive: true });
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(chunksDir, { recursive: true });

  const discoveredFiles = await expandSources(fs, sources);

  const sourceFiles: IngestionResult['sourceFiles'] = [];
  const chunks = [] as IngestionResult['chunks'];

  for (let i = 0; i < discoveredFiles.length; i += 1) {
    const originalPath = discoveredFiles[i];
    const docId = `doc${i}`;
    const copiedPath = joinWorkspacePath(sourcesDir, `${docId}-${basename(originalPath)}`);
    const extractedPath = joinWorkspacePath(extractedDir, `${docId}.txt`);

    await fs.copyFile(originalPath, copiedPath, { overwrite: true });
    const rawContent = await fs.readFile(copiedPath);
    const extractedText = await extractText({ filePath: copiedPath, content: rawContent });
    await fs.writeFile(extractedPath, extractedText, { overwrite: true, recursive: true });

    const docChunks = chunkText({
      docId,
      sourcePath: copiedPath,
      text: extractedText,
    });

    await fs.mkdir(joinWorkspacePath(chunksDir, docId), { recursive: true });
    for (const chunk of docChunks) {
      const chunkPath = joinWorkspacePath(chunksDir, docId, `${chunk.chunkId}.json`);
      await fs.writeFile(chunkPath, JSON.stringify(chunk, null, 2), {
        overwrite: true,
        recursive: true,
      });

      await workspace.index(chunkPath, chunk.text, {
        type: 'text',
        metadata: {
          runId,
          chunkId: chunk.chunkId,
          docId: chunk.docId,
          sourcePath: chunk.sourcePath,
        },
      });
    }

    chunks.push(...docChunks);
    sourceFiles.push({
      docId,
      originalPath,
      copiedPath,
      extractedPath,
    });
  }

  await emit({ type: 'ingest.done', docCount: sourceFiles.length, chunkCount: chunks.length });

  return {
    sourceFiles,
    chunks,
    chunkById: new Map(chunks.map(chunk => [chunk.chunkId, chunk])),
  };
}

async function expandSources(
  fs: NonNullable<Workspace['filesystem']>,
  sources: SourceRef[],
): Promise<string[]> {
  const results: string[] = [];

  for (const source of sources) {
    const sourcePath = normalizePath(source.path);
    const stat = await fs.stat(sourcePath);

    if (source.type === 'folder' || stat.type === 'directory') {
      const files = await listFilesRecursively(fs, sourcePath);
      for (const file of files) {
        if (isSupportedForExtraction(file)) {
          results.push(file);
        }
      }
      continue;
    }

    if (!isSupportedForExtraction(sourcePath)) {
      throw new Error(`Unsupported source extension: ${extension(sourcePath)} for ${sourcePath}`);
    }

    results.push(sourcePath);
  }

  return dedupe(results);
}

async function listFilesRecursively(
  fs: NonNullable<Workspace['filesystem']>,
  rootPath: string,
): Promise<string[]> {
  const normalizedRoot = normalizePath(rootPath);
  const entries = await fs.readdir(normalizedRoot);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = joinWorkspacePath(normalizedRoot, entry.name);
    if (entry.type === 'file') {
      files.push(fullPath);
      continue;
    }

    const nested = await listFilesRecursively(fs, fullPath);
    files.push(...nested);
  }

  return files;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export async function ensureRunLayout(workspace: Workspace, runId: string): Promise<void> {
  const fs = workspace.filesystem;
  if (!fs) {
    throw new Error('Workspace filesystem is not configured');
  }

  const root = `/rlm/runs/${runId}`;
  const dirs = [
    root,
    joinWorkspacePath(root, 'sources'),
    joinWorkspacePath(root, 'extracted'),
    joinWorkspacePath(root, 'chunks'),
    joinWorkspacePath(root, 'outputs'),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function writeRunInput(workspace: Workspace, runId: string, input: unknown): Promise<void> {
  const fs = workspace.filesystem;
  if (!fs) {
    throw new Error('Workspace filesystem is not configured');
  }

  const path = `/rlm/runs/${runId}/input.json`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(input, null, 2), { overwrite: true, recursive: true });
}
