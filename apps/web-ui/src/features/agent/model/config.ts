import type { AgentConfig } from '../types';

export type Path = (string | number)[];

export function parsePath(path: string): Path {
  if (!path) return [];
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).map(part => (/^\d+$/.test(part) ? Number(part) : part));
}

export function getIn(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<string | number, unknown>)[key] : undefined), value);
}

export function setIn<T extends AgentConfig>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  const source = (value ?? (typeof head === 'number' ? [] : {})) as Record<string | number, unknown> | unknown[];
  const copy: Record<string | number, unknown> | unknown[] = Array.isArray(source) ? [...source] : { ...source };
  (copy as Record<string | number, unknown>)[head!] = setIn((source as Record<string | number, unknown>)[head!] as AgentConfig, rest, next);
  return copy as T;
}

/** JSON with recursively sorted object keys, so jsonb key reordering does not look like an edit. */
export function canonical(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.keys(node).sort().map(key => [key, sort((node as Record<string, unknown>)[key])]));
    }
    return node;
  };
  return JSON.stringify(sort(value));
}

export const fieldId = (path: Path | string) => `field-${(typeof path === 'string' ? parsePath(path) : path).join('.')}`;

/** Focus the most specific rendered field for a runtime issue path (falls back to its parents). */
export function focusIssue(path: string): void {
  const parts = parsePath(path);
  for (let n = parts.length; n > 0; n -= 1) {
    const element = document.getElementById(fieldId(parts.slice(0, n)));
    if (element) { element.focus(); element.scrollIntoView?.({ block: 'center' }); return; }
  }
}
