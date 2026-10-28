import type { Hono } from 'hono';
import { honoHandler, withHandler } from '@/http/handler';
import { ProductError } from '@/http/errors';
import { requireSameOrigin } from '@/modules/auth/csrf';
import { newOwnerId, readOwner, setOwnerCookieOn } from '@/modules/conversations/owner';
import { forwardToRuntime } from '@/modules/conversations/runtime-proxy';

// Student chat BFF (SRS M-AUTH, ticket A-04 scaffold): anonymous owner cookie in, signed caller context out.
// Bodies are forwarded byte-for-byte so the runtime validates them and the signed body hash matches.
const MAX_BODY_BYTES = 64 * 1024;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type ConversationParams = { conversation_id: string };
type ResponseParams = { response_id: string };

function resourceId(value: string | undefined): string {
  if (!value || !RESOURCE_ID.test(value)) throw new ProductError(404, 'RES_NOT_FOUND', 'Resource not found');
  return value;
}

function requireOwner(req: Request): string {
  const owner = readOwner(req);
  if (!owner) throw new ProductError(401, 'AUTH_TOKEN_MISSING', 'Conversation owner cookie required');
  return owner;
}

async function readBody(req: Request): Promise<string> {
  const body = await req.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new ProductError(413, 'VAL_PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  return body;
}

/** Creates the owner on first use; a valid existing cookie keeps the student's conversations together. */
export const handleCreateConversation = withHandler(async (req, ctx) => {
  requireSameOrigin(req);
  const existing = readOwner(req);
  const owner = existing ?? newOwnerId();
  const res = await forwardToRuntime('POST', '/conversations', await readBody(req), owner, ctx);
  return existing || !res.ok ? res : setOwnerCookieOn(res, owner);
});

export const handleReadConversation = withHandler<ConversationParams>(async (req, ctx, route) => {
  const id = resourceId(route.params.conversation_id);
  return forwardToRuntime('GET', `/conversations/${id}`, '', requireOwner(req), ctx);
});

export const handleListMessages = withHandler<ConversationParams>(async (req, ctx, route) => {
  const id = resourceId(route.params.conversation_id);
  const source = new URL(req.url).searchParams;
  const query = new URLSearchParams();
  for (const name of ['cursor', 'limit']) {
    const value = source.get(name);
    if (value !== null) query.set(name, value);
  }
  const suffix = query.size ? `?${query}` : '';
  return forwardToRuntime('GET', `/conversations/${id}/messages${suffix}`, '', requireOwner(req), ctx);
});

/** JSON only for now: the runtime also streams SSE, which the web UI does not consume yet. */
export const handleCreateMessage = withHandler<ConversationParams>(async (req, ctx, route) => {
  requireSameOrigin(req);
  const id = resourceId(route.params.conversation_id);
  return forwardToRuntime('POST', `/conversations/${id}/messages`, await readBody(req), requireOwner(req), ctx);
});

export const handleReadResponse = withHandler<ResponseParams>(async (req, ctx, route) => {
  const id = resourceId(route.params.response_id);
  return forwardToRuntime('GET', `/responses/${id}`, '', requireOwner(req), ctx);
});

export function registerConversationRoutes(app: Hono): void {
  app.post('/api/v1/conversations', honoHandler(handleCreateConversation));
  app.get('/api/v1/conversations/:conversation_id', honoHandler(handleReadConversation));
  app.get('/api/v1/conversations/:conversation_id/messages', honoHandler(handleListMessages));
  app.post('/api/v1/conversations/:conversation_id/messages', honoHandler(handleCreateMessage));
  app.get('/api/v1/responses/:response_id', honoHandler(handleReadResponse));
}
