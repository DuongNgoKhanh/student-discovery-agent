import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { ProductError } from '@/http/errors';

/** Special characters accepted by the legacy Python `validate_password`. */
export const PASSWORD_SPECIALS = '!@#$%^&*()-_+=[]{}|;:,.<>?/';

/**
 * Registration policy for NEW passwords, rule-for-rule and message-for-message with
 * `app/modules/users/utils/auth.py::validate_password`. Returns the first violation or null.
 * Never applied when verifying an existing hash.
 */
export function passwordPolicyError(password: string): string | null {
  if (!password) return 'Password cannot be empty';
  if ([...password].length < 8) return 'Password must be at least 8 characters long';
  if (!/\p{Nd}/u.test(password)) return 'Password must contain at least one number';
  if (!/\p{Lu}/u.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/\p{Ll}/u.test(password)) return 'Password must contain at least one lowercase letter';
  if (![...password].some((c) => PASSWORD_SPECIALS.includes(c))) {
    return 'Password must contain at least one special character';
  }
  return null;
}

/** Throws the legacy-equivalent 400 when the password violates the registration policy. */
export function assertPasswordPolicy(password: string): void {
  const message = passwordPolicyError(password);
  if (message) throw new ProductError(400, 'VAL_INVALID_PASSWORD', message);
}

// Same cost parameters as passlib's argon2 defaults used by the legacy service.
const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

/**
 * Hash a new password as an Argon2id PHC string (`$argon2id$v=19$...`), like legacy passlib.
 * Applies the registration policy unless `skipPolicy` (only for tests / admin tooling).
 */
export async function hashPassword(password: string, opts: { skipPolicy?: boolean } = {}): Promise<string> {
  if (!opts.skipPolicy) assertPasswordPolicy(password);
  // @node-rs/argon2 defaults to Argon2id, version 0x13.
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Verify against an existing hash: Argon2 PHC (`$argon2id$`, `$argon2i$`, `$argon2d$`) or
 * legacy bcrypt (`$2a$`/`$2b$`/`$2y$`). Unknown/corrupt hashes return false, never throw.
 * Does not rehash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    if (hash.startsWith('$argon2')) return await argon2Verify(hash, password);
    if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return await bcrypt.compare(password, hash);
    return false;
  } catch {
    return false;
  }
}
