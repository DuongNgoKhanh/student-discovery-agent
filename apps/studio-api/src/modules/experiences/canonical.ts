import { createHash } from 'node:crypto';

/**
 * RFC 8785: ECMAScript number serialization and UTF-16 code-unit key order.
 * Matches Python's JCS serializer. Rejects non-finite numbers and lone surrogates.
 */
export function canonicalJson(data: unknown): string {
  if (typeof data === 'string' && /[\uD800-\uDFFF]/u.test(data)) {
    throw new RangeError('lone surrogate');
  }
  if (typeof data === 'number') {
    if (!Number.isFinite(data)) {
      throw new RangeError('non-finite number');
    }
    return JSON.stringify(data);
  }

  if (data === null || typeof data !== 'object') {
    return JSON.stringify(data) ?? 'null';
  }

  if (Array.isArray(data)) {
    return '[' + data.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',') + ']';
  }

  const obj = data as Record<string, unknown>;
  const pairs = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${canonicalJson(k)}:${canonicalJson(obj[k])}`);

  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 canonical hash formatted as `sha256:<64-hex-digest>`.
 */
export function computeContentHash(data: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(data), 'utf8').digest('hex')}`;
}

