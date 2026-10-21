import { beforeEach, expect, it, vi } from 'vitest';
import { bulkDeleteUsers } from './users.service';
import { findUserById } from './users.repository';
import { ProductError } from '@/http/errors';
import type { ProductDatabase } from '@/infrastructure/db/client';

vi.mock('./users.repository', () => ({ findUserById: vi.fn(), insertUser: vi.fn(), updateUserRow: vi.fn() }));
beforeEach(() => vi.mocked(findUserById).mockReset());

it('canonicalizes per-item bulk errors with the same compatibility marker as HTTP failures', async () => {
  vi.mocked(findUserById).mockRejectedValueOnce(new ProductError(409, 'REVISION_CONFLICT', 'Retry with current revision'));
  const result = await bulkDeleteUsers({} as ProductDatabase, [1]);
  expect(result.data[0]).toMatchObject({ status: 409, success: false, error: { code: 'CONFLICT_REVISION', legacy_code: 'REVISION_CONFLICT', message: 'Retry with current revision' } });
});

it('hides unregistered bulk errors with a coherent per-item 500 status', async () => {
  vi.mocked(findUserById).mockRejectedValueOnce(new ProductError(400, 'PRIVATE_DATABASE_CODE', 'credential', true, { secret: 'password' }));
  const result = await bulkDeleteUsers({} as ProductDatabase, [1]);
  expect(result.data[0]).toMatchObject({ status: 500, error: { code: 'SYS_INTERNAL_ERROR', message: 'Internal server error', retryable: false, details: null } });
  expect(result.data[0]?.error).not.toHaveProperty('legacy_code');
  expect(JSON.stringify(result)).not.toContain('credential');
});
