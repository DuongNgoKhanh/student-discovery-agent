import { isJsonContentType } from '@/http/body';
import { ProductError } from '@/http/errors';

export const DEFAULT_MAX_EXPERIENCE_BODY_BYTES = 1024 * 1024; // 1 MB

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
          throw new ProductError(400, 'INVALID_REQUEST', `Duplicate key "${key}"`);
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
 */
export function parseExperienceJson(text: string): unknown {
  try {
    const parsed = JSON.parse(text, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new ProductError(400, 'INVALID_REQUEST', 'Non-finite numbers are not allowed');
      }
      return value;
    });
    assertNoDuplicateKeys(text);
    return parsed;
  } catch (err) {
    if (err instanceof ProductError) {
      throw err;
    }
    throw new ProductError(400, 'INVALID_REQUEST', 'Malformed JSON body');
  }
}

export interface ReadExperienceJsonBodyOptions {
  optional?: boolean;
  maxBytes?: number;
}

/**
 * Reads and parses an incoming Experience JSON request body.
 * - Enforces JSON Content-Type (415 VAL_UNSUPPORTED_MEDIA_TYPE).
 * - Enforces payload size limit (413 PAYLOAD_TOO_LARGE, default 1MB).
 * - Enforces required body unless opts.optional is true (400 INVALID_REQUEST).
 * - Rejects malformed JSON, non-finite numbers, and duplicate keys (400 INVALID_REQUEST).
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
      throw new ProductError(413, 'PAYLOAD_TOO_LARGE', `Payload exceeds size limit of ${maxBytes} bytes`);
    }
  }

  const text = await req.text();
  const empty = !text.trim();

  if (empty && opts.optional) {
    return undefined;
  }

  if (!isJsonContentType(req.headers.get('content-type'))) {
    throw new ProductError(415, 'VAL_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  if (empty) {
    throw new ProductError(400, 'INVALID_REQUEST', 'Request body is required');
  }

  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ProductError(413, 'PAYLOAD_TOO_LARGE', `Payload exceeds size limit of ${maxBytes} bytes`);
  }

  return parseExperienceJson(text);
}

