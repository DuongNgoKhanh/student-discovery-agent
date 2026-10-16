import 'server-only';
import { ProductError } from './errors';

/**
 * Read a JSON request body. Malformed JSON -> 400 VAL_INVALID_REQUEST (not a 500).
 * With `optional`, an empty body yields `undefined`.
 */
export async function readJsonBody(req: Request, opts: { optional?: boolean } = {}): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) {
    if (opts.optional) return undefined;
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Request body is required');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Malformed JSON body');
  }
}
