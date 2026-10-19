import { ProductError } from '@/http/errors';

// `application/json` or a structured `application/*+json` type, optionally with parameters.
const JSON_MEDIA_TYPE = /^application\/(?:json|[a-z0-9!#$&^_.-]+\+json)$/;

export function isJsonContentType(header: string | null): boolean {
  if (!header) return false;
  const mediaType = header.split(';', 1)[0]!.trim().toLowerCase();
  return JSON_MEDIA_TYPE.test(mediaType);
}

/**
 * Read a JSON request body.
 * - A non-empty body must declare a JSON content type, else 415 VAL_UNSUPPORTED_MEDIA_TYPE.
 *   This is CSRF hardening: browsers can only send cross-site "simple" requests with
 *   text/plain, form-urlencoded or multipart bodies, never application/json.
 * - Malformed JSON -> 400 VAL_INVALID_REQUEST (not a 500).
 * - With `optional`, an empty body yields `undefined` regardless of content type.
 */
export async function readJsonBody(req: Request, opts: { optional?: boolean } = {}): Promise<unknown> {
  const text = await req.text();
  const empty = !text.trim();
  if (empty && opts.optional) return undefined;
  if (!isJsonContentType(req.headers.get('content-type'))) {
    throw new ProductError(415, 'VAL_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  if (empty) throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Request body is required');
  try {
    return JSON.parse(text);
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Malformed JSON body');
  }
}
