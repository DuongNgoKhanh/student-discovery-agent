import { createHash } from 'node:crypto';

/**
 * Compare two string keys by Unicode code point sequence (equivalent to UTF-8 byte order),
 * complying with RFC 8785 (JSON Canonicalization Scheme - JCS) Section 3.2.3 and matching
 * Python's `json.dumps(sort_keys=True)`.
 */
function compareKeys(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Serializes input data to deterministic canonical JSON according to RFC 8785 principles.
 * Rejects non-finite numbers (NaN, Infinity, -Infinity) by throwing a RangeError.
 */
export function canonicalJson(data: unknown): string {
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
    .sort(compareKeys)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);

  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 canonical hash formatted as `sha256:<64-hex-digest>`.
 */
export function computeContentHash(data: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(data), 'utf8').digest('hex')}`;
}

