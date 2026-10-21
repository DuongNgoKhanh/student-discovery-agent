import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

// Socket peers are supplied only by the Node transport, never by request headers.
const peers = new WeakMap<Request, string>();
export function setTrustedPeer(req: Request, address: string): void { peers.set(req, address); }
export async function limitRegistration(db: ProductDatabase, req: Request, email: string): Promise<void> {
  const key = (value: string) => createHmac('sha256', getAuthEnv().SECRET_KEY).update(value).digest('hex');
  const address = await registrationAddress(req);
  const keys = [[key(`peer:${address}`), 20], [key(`email:${email.toLowerCase()}`), 5]] as const;
  const allowed = await db.transaction(async tx => {
    // A short lock makes cleanup, capacity checks and both counters atomic across API processes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7241003002)`);
    await tx.execute(sql`DELETE FROM product.auth_registration_limits WHERE expires_at<=now()`);
    const count = await tx.execute(sql`SELECT count(*)::integer AS count FROM product.auth_registration_limits`);
    if (Number(count.rows[0]?.count) >= 10000) return false;
    let ok = true;
    for (const [keyHash, max] of keys) {
      const result = await tx.execute(sql`INSERT INTO product.auth_registration_limits(key_hash,attempts,expires_at)
        VALUES(${keyHash},1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE
        SET attempts=least(product.auth_registration_limits.attempts+1,1000000) RETURNING attempts`);
      if (Number(result.rows[0]?.attempts) > max) ok = false;
    }
    return ok;
  });
  if (!allowed) throw new ProductError(429, 'AUTH_RATE_LIMITED', 'Too many registration attempts; try again later');
}

function normalizeIp(address: string): string {
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  if (isIP(address) === 6) {
    const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16); const low = parseInt(mapped[2]!, 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return canonical;
  }
  return address;
}
const resolvedProxies = new Map<string, { expires: number; addresses: string[] }>();
async function proxyAddresses(host: string): Promise<string[]> {
  if (isIP(host)) return [normalizeIp(host)];
  const cached = resolvedProxies.get(host);
  if (cached && cached.expires > Date.now()) return cached.addresses;
  try {
    const addresses = (await lookup(host, { all: true })).map(item => normalizeIp(item.address));
    if (resolvedProxies.size >= 32) resolvedProxies.clear();
    resolvedProxies.set(host, { expires: Date.now() + 60_000, addresses });
    return addresses;
  } catch {
    // DNS outages remove proxy trust; direct peer limiting remains available.
    return [];
  }
}
async function registrationAddress(req: Request): Promise<string> {
  const peer = normalizeIp(peers.get(req) ?? 'unknown');
  const client = req.headers.get('x-sda-client-ip');
  if (!client || !isIP(client)) return peer;
  for (const host of getAuthEnv().AUTH_TRUSTED_PROXY_HOSTS) {
    if ((await proxyAddresses(host)).includes(peer)) return normalizeIp(client);
  }
  return peer;
}
