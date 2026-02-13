import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { workspace } from "../workspace/workspace";

type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: TreeEntry[];
};

const treeEntrySchema: z.ZodType<TreeEntry> = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number().optional(),
  children: z.array(z.lazy(() => treeEntrySchema)).optional(),
});

const listInputSchema = z.object({
  path: z.string().optional().default("/"),
  maxDepth: z.number().int().min(0).max(10).optional().default(3),
  showHidden: z.boolean().optional().default(false),
  dirsOnly: z.boolean().optional().default(false),
  exclude: z.union([z.string(), z.array(z.string())]).optional(),
  extension: z.union([z.string(), z.array(z.string())]).optional(),
});

export const listBucketFilesTool = createTool({
  id: "list-bucket-files",
  description:
    "List files and folders in the workspace filesystem (S3/R2 bucket). Use this for bucket exploration.",
  inputSchema: listInputSchema,
  outputSchema: z.object({
    path: z.string(),
    totalEntries: z.number(),
    entries: z.array(treeEntrySchema),
  }),
  execute: async (input) => {
    const fs = workspace.filesystem;
    if (!fs) {
      throw new Error("Workspace filesystem is not configured");
    }

    const normalizedPath = normalizePath(input.path ?? "/");
    const entries = await listDirectoryTree(fs, normalizedPath, 0, {
      maxDepth: input.maxDepth ?? 3,
      showHidden: input.showHidden ?? false,
      dirsOnly: input.dirsOnly ?? false,
      exclude: toArray(input.exclude),
      extensions: normalizeExtensions(input.extension),
    });

    return {
      path: normalizedPath,
      totalEntries: countEntries(entries),
      entries,
    };
  },
});

async function listDirectoryTree(
  fs: NonNullable<typeof workspace.filesystem>,
  dirPath: string,
  depth: number,
  options: {
    maxDepth: number;
    showHidden: boolean;
    dirsOnly: boolean;
    exclude: string[];
    extensions: string[];
  }
): Promise<TreeEntry[]> {
  const items = await fs.readdir(dirPath);
  const entries: TreeEntry[] = [];

  for (const item of items) {
    if (!options.showHidden && item.name.startsWith(".")) continue;

    const fullPath = dirPath === "/" ? `/${item.name}` : `${dirPath}/${item.name}`;

    if (shouldExclude(fullPath, options.exclude)) continue;

    if (item.type === "file") {
      if (options.dirsOnly) continue;
      if (options.extensions.length > 0 && !matchesExtension(item.name, options.extensions)) continue;

      entries.push({
        name: item.name,
        path: fullPath,
        type: "file",
        size: item.size,
      });
      continue;
    }

    const node: TreeEntry = {
      name: item.name,
      path: fullPath,
      type: "directory",
    };

    if (depth < options.maxDepth) {
      node.children = await listDirectoryTree(fs, fullPath, depth + 1, options);
    }

    entries.push(node);
  }

  return entries.sort(sortEntries);
}

function normalizePath(path: string): string {
  if (!path || path === ".") return "/";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeExtensions(value: string | string[] | undefined): string[] {
  return toArray(value)
    .map(ext => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
    .filter(Boolean);
}

function shouldExclude(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => path.includes(pattern));
}

function matchesExtension(name: string, extensions: string[]): boolean {
  const lowerName = name.toLowerCase();
  return extensions.some(ext => lowerName.endsWith(ext));
}

function sortEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function countEntries(entries: TreeEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += 1;
    if (entry.children) total += countEntries(entry.children);
  }
  return total;
}
