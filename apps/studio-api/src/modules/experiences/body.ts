import { isJsonContentType } from '@/http/body';
import { ProductError } from '@/http/errors';

export const DEFAULT_MAX_EXPERIENCE_BODY_BYTES = 1024 * 1024; // 1 MB

// With the u flag, valid surrogate pairs match as one code point, so this finds only lone halves.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

interface ObjectFrame {
  keys: Set<string>;
  expectingKey: boolean;
}

/**
 * Validates that no JSON object in the input string contains duplicate keys.
 * Expects syntactically valid JSON (typically pre-validated by JSON.parse).
 */
export function assertNoDuplicateKeys(text: string): void {
  const stack: ('array' | ObjectFrame)[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (ch === '{') {
      stack.push({ keys: new Set(), expectingKey: true });
      i++;
    } else if (ch === '}') {
      stack.pop();
      i++;
    } else if (ch === '[') {
      stack.push('array');
      i++;
    } else if (ch === ']') {
      stack.pop();
      i++;
    } else if (ch === ',') {
      const top = stack[stack.length - 1];
      if (top && typeof top === 'object') {
        top.expectingKey = true;
      }
      i++;
    } else if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < len) {
        if (text[i] === '\\') {
          i += 2; // skip escape sequence
        } else if (text[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          i++;
        }
      }
      const rawStringToken = text.slice(start, i);
      const top = stack[stack.length - 1];
      if (top && typeof top === 'object' && top.expectingKey) {
        let key: string;
        try {
          key = JSON.parse(rawStringToken) as string;
        } catch {
          key = rawStringToken;
        }
        if (top.keys.has(key)) {
          throw new ProductError(400, 'VAL_INVALID_REQUEST', `Duplicate key "${key}"`);
        }
        top.keys.add(key);
        top.expectingKey = false;
      }
    } else {
      i++;
    }
  }
}

/**
 * Parses a JSON string while enforcing:
 * 1. Strict syntax (no malformed JSON)
 * 2. No non-finite numbers (NaN, Infinity, -Infinity)
 * 3. No duplicate keys in any JSON object
 * 4. No lone surrogates in keys or strings (canonical hashing cannot encode them)
 * 5. No integers beyond Number.MAX_SAFE_INTEGER (JS rounds them while Python keeps them exact,
 *    so the content hash would differ between services)
 */
export function parseExperienceJson(text: string): unknown {
  try {
    const parsed = JSON.parse(text, (key, value) => {
      if (LONE_SURROGATE.test(key) || (typeof value === 'string' && LONE_SURROGATE.test(value))) {
        throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Strings must not contain lone surrogates');
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Non-finite numbers are not allowed');
        }
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Integers beyond 2^53-1 are not allowed');
        }
      }
      return value;
    });
    assertNoDuplicateKeys(text);
    return parsed;
  } catch (err) {
    if (err instanceof ProductError) {
      throw err;
    }
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Malformed JSON body');
  }
}

function decodeUtf8(decoder: TextDecoder, chunk?: Uint8Array): string {
  try {
    return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Request body is not valid UTF-8');
  }
}

export interface ReadExperienceJsonBodyOptions {
  optional?: boolean;
  maxBytes?: number;
}

/**
 * Reads and parses an incoming Experience JSON request body.
 * - Enforces JSON Content-Type (415 VAL_UNSUPPORTED_MEDIA_TYPE).
 * - Enforces payload size limit (413 VAL_PAYLOAD_TOO_LARGE, default 1MB).
 * - Enforces required body unless opts.optional is true (400 VAL_INVALID_REQUEST).
 * - Rejects malformed JSON, non-finite numbers, duplicate keys, lone surrogates, unsafe integers
 *   and invalid UTF-8 (400 VAL_INVALID_REQUEST).
 */
export async function readExperienceJsonBody(
  req: Request,
  opts: ReadExperienceJsonBodyOptions = {},
): Promise<unknown> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_EXPERIENCE_BODY_BYTES;

  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      void req.body?.cancel().catch(() => {});
      throw new ProductError(413, 'VAL_PAYLOAD_TOO_LARGE', `Payload exceeds size limit of ${maxBytes} bytes`);
    }
  }

  let text = '';
  if (req.body) {
    const reader = req.body.getReader();
    // fatal: reject invalid UTF-8 instead of silently storing and hashing U+FFFD replacements.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytesRead = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          // Stop consuming immediately; a failing cancellation must not hide the 413.
          void reader.cancel().catch(() => {});
          throw new ProductError(413, 'VAL_PAYLOAD_TOO_LARGE', `Payload exceeds size limit of ${maxBytes} bytes`);
        }
        text += decodeUtf8(decoder, value);
      }
      text += decodeUtf8(decoder);
    } finally {
      reader.releaseLock();
    }
  }
  const empty = !text.trim();

  if (empty && opts.optional) {
    return undefined;
  }

  if (!isJsonContentType(req.headers.get('content-type'))) {
    throw new ProductError(415, 'VAL_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  if (empty) {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Request body is required');
  }

  return parseExperienceJson(text);
}
