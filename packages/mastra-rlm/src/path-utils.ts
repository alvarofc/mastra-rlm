export function normalizePath(path: string): string {
  if (!path || path === '.') return '/';
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const normalized = withLeadingSlash.replace(/\\+/g, '/').replace(/\/+/g, '/');
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function joinWorkspacePath(...parts: string[]): string {
  const joined = parts
    .map((part, index) => {
      if (index === 0) return part;
      return part.replace(/^\/+/, '');
    })
    .join('/');
  return normalizePath(joined);
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export function extension(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf('.');
  if (idx < 0) return '';
  return base.slice(idx).toLowerCase();
}
