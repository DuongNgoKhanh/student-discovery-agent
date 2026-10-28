import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDatabase } from '@/infrastructure/db/client';
import * as repo from '@/modules/agent/agent.repository';
import { readDraft, saveDraftContent, seedAgent } from '@/modules/agent/agent.service';
import { computeContentHash } from '@/modules/experiences/canonical';

vi.mock('@/modules/agent/agent.repository');
const db = { transaction: (work: (tx: unknown) => unknown) => work(db) } as unknown as ProductDatabase;
const at = new Date('2026-10-28T00:00:00Z');
const draftRow = (content: Record<string, unknown>, revision = 1) =>
  ({ id: 'default', content, revision, content_hash: computeContentHash(content), updated_by: 'admin', updated_at: at });

beforeEach(() => vi.clearAllMocks());

describe('agent draft', () => {
  it('reads the draft as a DTO', async () => {
    vi.mocked(repo.getDraft).mockResolvedValue(draftRow({ greeting_text: 'Chào' }));
    await expect(readDraft(db)).resolves.toMatchObject({ content: { greeting_text: 'Chào' }, revision: 1 });
  });

  it('404s when nothing was seeded', async () => {
    vi.mocked(repo.getDraft).mockResolvedValue(undefined);
    await expect(readDraft(db)).rejects.toMatchObject({ status: 404, code: 'RES_NOT_FOUND' });
  });

  it('hashes the content and maps a stale revision to 409 with the server copy', async () => {
    const current = draftRow({ greeting_text: 'server' }, 3);
    vi.mocked(repo.saveDraft).mockResolvedValue({ status: 'conflict', current });
    await expect(saveDraftContent(db, { content: { greeting_text: 'mine' }, expected_revision: 2 }, 'admin'))
      .rejects.toMatchObject({ status: 409, code: 'CONFLICT_REVISION', details: { current: { revision: 3 } } });
    expect(vi.mocked(repo.saveDraft).mock.calls[0]![1]).toMatchObject({ hash: computeContentHash({ greeting_text: 'mine' }) });
  });

  it('seeds draft, v1 and the pointer only once', async () => {
    vi.mocked(repo.countReleases).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    vi.mocked(repo.insertRelease).mockResolvedValue({ id: 'agr_1', version: 1 } as repo.AgentReleaseRow);
    vi.mocked(repo.pointActive).mockResolvedValue({} as repo.AgentActiveRow);
    await expect(seedAgent(db, { greeting_text: 'x' })).resolves.toBe('seeded');
    await expect(seedAgent(db, { greeting_text: 'x' })).resolves.toBe('skipped');
    expect(repo.insertRelease).toHaveBeenCalledTimes(1);
    expect(repo.insertAudit).toHaveBeenCalledWith(db, expect.objectContaining({ actor: 'system:seed', action: 'agent.release.publish' }));
  });
});
