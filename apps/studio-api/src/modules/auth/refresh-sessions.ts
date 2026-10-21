import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { refreshTokenTtlSeconds } from './tokens';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const invalid = () => new ProductError(401, 'AUTH_INVALID_TOKEN', 'Session is invalid or revoked');
const opaqueToken = () => randomBytes(32).toString('base64url');
export interface RefreshSession { token: string; session_id: string; user_id: number; max_age: number }

export async function createRefreshSession(db: ProductDatabase, userId: number): Promise<RefreshSession> {
  const token = opaqueToken(); const sessionId = randomUUID(); const maxAge = refreshTokenTtlSeconds();
  await db.transaction(async tx => {
    // Expired families and all their consumed-token records are removed in bounded batches.
    await tx.execute(sql`DELETE FROM product.auth_sessions WHERE id IN
      (SELECT id FROM product.auth_sessions WHERE expires_at <= now() LIMIT 1000)`);
    await tx.execute(sql`INSERT INTO product.auth_sessions(id,user_id,expires_at)
      VALUES(${sessionId},${userId},now() + ${maxAge} * interval '1 second')`);
    await tx.execute(sql`INSERT INTO product.auth_refresh_tokens(token_hash,session_id) VALUES(${hash(token)},${sessionId})`);
  });
  return { token, session_id: sessionId, user_id: userId, max_age: maxAge };
}

export async function rotateRefreshSession(db: ProductDatabase, token: string): Promise<RefreshSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  // Lock the family, not only the token: logout/reuse/rotation serialize on the same row.
  const result = await db.transaction(async tx => {
    const found = await tx.execute(sql`SELECT s.id, s.user_id, s.expires_at, s.revoked_at, t.consumed_at,
        u.is_deleted, floor(extract(epoch FROM (s.expires_at-now())))::integer AS max_age
      FROM product.auth_refresh_tokens t JOIN product.auth_sessions s ON s.id=t.session_id
      JOIN product.users u ON u.id=s.user_id WHERE t.token_hash=${hash(token)} FOR UPDATE OF s,t`);
    const row = found.rows[0];
    if (!row || row.revoked_at || row.is_deleted) return { error: 'invalid' } as const;
    if (Number(row.max_age) <= 0) return { error: 'expired' } as const;
    if (row.consumed_at) {
      await tx.execute(sql`UPDATE product.auth_sessions SET revoked_at=now() WHERE id=${row.id}`);
      return { error: 'invalid' } as const;
    }
    const next = opaqueToken();
    await tx.execute(sql`UPDATE product.auth_refresh_tokens SET consumed_at=now() WHERE token_hash=${hash(token)}`);
    await tx.execute(sql`INSERT INTO product.auth_refresh_tokens(token_hash,session_id) VALUES(${hash(next)},${row.id})`);
    return { token: next, session_id: String(row.id), user_id: Number(row.user_id), max_age: Number(row.max_age) };
  });
  // Throw outside the transaction so replay revocation is committed.
  if ('error' in result) {
    if (result.error === 'expired') throw new ProductError(401, 'AUTH_TOKEN_EXPIRED', 'Refresh session has expired');
    throw invalid();
  }
  return result;
}

export async function revokeRefreshSession(db: ProductDatabase, token?: string): Promise<void> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await db.execute(sql`UPDATE product.auth_sessions SET revoked_at=now() WHERE id IN
    (SELECT session_id FROM product.auth_refresh_tokens WHERE token_hash=${hash(token)})`);
}
export async function assertActiveSession(db: ProductDatabase, sessionId: string, userId: string): Promise<void> {
  const found = await db.execute(sql`SELECT s.id FROM product.auth_sessions s JOIN product.users u ON u.id=s.user_id
    WHERE s.id=${sessionId} AND s.user_id::text=${userId} AND s.revoked_at IS NULL
    AND s.expires_at>now() AND u.is_deleted=false`);
  if (!found.rows.length) throw invalid();
}

/** Revoke only a family named by an already signature/expiry-verified access JWT. */
export async function revokeAccessSession(db: ProductDatabase, sessionId: string, userId: string): Promise<void> {
  await db.execute(sql`UPDATE product.auth_sessions SET revoked_at=now()
    WHERE id=${sessionId} AND user_id::text=${userId}`);
}
