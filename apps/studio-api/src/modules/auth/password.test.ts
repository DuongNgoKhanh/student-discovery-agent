import { describe, it, expect } from 'vitest';
import legacy from '../../../tests/fixtures/legacy/auth.json';
import { hashPassword, passwordPolicyError, verifyPassword } from '@/modules/auth/password';

describe('verifyPassword (legacy passlib hashes, verified as-is)', () => {
  it('accepts_python_hashes', async () => {
    expect(await verifyPassword(legacy.password, legacy.argon2_hash)).toBe(true);
    expect(await verifyPassword(legacy.password, legacy.bcrypt_hash)).toBe(true);
  });

  it('rejects a wrong password for both schemes', async () => {
    expect(await verifyPassword('LegacyPass1?', legacy.argon2_hash)).toBe(false);
    expect(await verifyPassword('LegacyPass1?', legacy.bcrypt_hash)).toBe(false);
  });

  it('returns false (never throws) for empty input, unknown scheme or corrupt hash', async () => {
    expect(await verifyPassword('', legacy.argon2_hash)).toBe(false);
    expect(await verifyPassword(legacy.password, '')).toBe(false);
    expect(await verifyPassword(legacy.password, 'plaintext')).toBe(false);
    expect(await verifyPassword(legacy.password, '$argon2id$v=19$garbage')).toBe(false);
    expect(await verifyPassword(legacy.password, '$2b$12$short')).toBe(false);
  });

  it('does not apply the registration policy to existing hashes', async () => {
    // A weak password that a legacy account may still have must verify.
    const weak = await hashPassword('short', { skipPolicy: true });
    expect(await verifyPassword('short', weak)).toBe(true);
  });
});

describe('hashPassword', () => {
  it('produces an Argon2id PHC string that verifies', async () => {
    const hash = await hashPassword('NewPass1!x');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(await verifyPassword('NewPass1!x', hash)).toBe(true);
    expect(await verifyPassword('NewPass1!y', hash)).toBe(false);
  });

  it('rejects passwords that fail the registration policy', async () => {
    await expect(hashPassword('weak')).rejects.toThrow();
  });
});

describe('passwordPolicyError (Python validate_password rules)', () => {
  it.each([
    ['', 'Password cannot be empty'],
    ['Ab1!xyz', 'Password must be at least 8 characters long'],
    ['Abcdefg!', 'Password must contain at least one number'],
    ['abcdefg1!', 'Password must contain at least one uppercase letter'],
    ['ABCDEFG1!', 'Password must contain at least one lowercase letter'],
    ['Abcdefg12', 'Password must contain at least one special character'],
  ])('%j -> %s', (pw, message) => {
    expect(passwordPolicyError(pw)).toBe(message);
  });

  it('accepts every special character from the legacy set', () => {
    for (const ch of '!@#$%^&*()-_+=[]{}|;:,.<>?/') {
      expect(passwordPolicyError(`Abcdefg1${ch}`)).toBeNull();
    }
  });

  it('does not count characters outside the legacy set as special', () => {
    expect(passwordPolicyError('Abcdefg1~')).toBe('Password must contain at least one special character');
  });
});
