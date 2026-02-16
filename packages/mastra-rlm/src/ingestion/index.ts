import type { Workspace } from '@mastra/core/workspace';

import { basename, dirname, extension, joinWorkspacePath, normalizePath } from '../path-utils';
import type { IngestionResult, RlmEvent, SourceRef } from '../types';
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

  await fs.mkdir(sourcesDir, { recursive: true });
  await fs.mkdir(extractedDir, { recursive: true });

  const discoveredFiles = await expandSources(fs, sources, runId);

  const sourceFiles: IngestionResult['sourceFiles'] = [];
  let contextChars = 0;

  for (let i = 0; i < discoveredFiles.length; i += 1) {
    const originalPath = discoveredFiles[i];
    const docId = `doc${i}`;
    const copiedPath = joinWorkspacePath(sourcesDir, `${docId}-${basename(originalPath)}`);
    const extractedPath = joinWorkspacePath(extractedDir, `${docId}.txt`);

    await fs.copyFile(originalPath, copiedPath, { overwrite: true });
    const rawContent = await fs.readFile(copiedPath);
    const extractedText = await extractText({ filePath: copiedPath, content: rawContent });
    await fs.writeFile(extractedPath, extractedText, { overwrite: true, recursive: true });

    const charLength = extractedText.length;
    contextChars += charLength;

    sourceFiles.push({
      docId,
      originalPath,
      copiedPath,
      extractedPath,
      text: extractedText,
      charLength,
    });
  }

  await emit({ type: 'ingest.done', docCount: sourceFiles.length, contextChars });

  const context = {
    task: '',
    documents: sourceFiles.map(file => ({
      docId: file.docId,
      sourcePath: file.originalPath,
      content: file.text,
    })),
  };

  return {
    sourceFiles,
    context,
  };
}

async function expandSources(
  fs: NonNullable<Workspace['filesystem']>,
  sources: SourceRef[],
  runId: string,
): Promise<string[]> {
  const results: string[] = [];
  const blockedPrefixes = blockedIngestionPrefixes(runId);

  for (const source of sources) {
    const sourcePath = normalizePath(source.path);

    if (sourcePath === '/rlm/runs' || sourcePath.startsWith('/rlm/runs/')) {
      throw new Error(
        `Invalid source path: ${sourcePath}. Do not use generated /rlm/runs artifacts as input sources. Use original source files instead.`,
      );
    }

    const stat = await fs.stat(sourcePath);

    if (source.type === 'folder' || stat.type === 'directory') {
      const files = await listFilesRecursively(fs, sourcePath, blockedPrefixes);
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
  blockedPrefixes: string[],
): Promise<string[]> {
  const normalizedRoot = normalizePath(rootPath);
  if (isBlockedPath(normalizedRoot, blockedPrefixes)) {
    return [];
  }

  const entries = await fs.readdir(normalizedRoot);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = joinWorkspacePath(normalizedRoot, entry.name);
    if (entry.type === 'file') {
      files.push(fullPath);
      continue;
    }

    const nested = await listFilesRecursively(fs, fullPath, blockedPrefixes);
    files.push(...nested);
  }

  return files;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function blockedIngestionPrefixes(runId: string): string[] {
  return [
    '/rlm',
    '/rlm/runs',
    `/rlm/runs/${runId}`,
  ];
}

function isBlockedPath(path: string, blockedPrefixes: string[]): boolean {
  const normalized = normalizePath(path);
  return blockedPrefixes.some(prefix => {
    const base = normalizePath(prefix);
    return normalized === base || normalized.startsWith(`${base}/`);
  });
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
    joinWorkspacePath(root, 'repl'),
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
