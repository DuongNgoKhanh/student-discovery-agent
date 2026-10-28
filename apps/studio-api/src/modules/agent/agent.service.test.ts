import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDatabase } from '@/infrastructure/db/client';
import * as repo from '@/modules/agent/agent.repository';
import { activeDescriptor, publish, readDraft, restore, saveDraftContent, seedAgent } from '@/modules/agent/agent.service';
import { setAgentValidator } from '@/modules/agent/runtime-validation';
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

  it('writes the save audit inside the save transaction', async () => {
    const tx = { marker: 'tx' };
    const txDb = { transaction: (work: (t: unknown) => unknown) => work(tx) } as unknown as ProductDatabase;
    vi.mocked(repo.saveDraft).mockResolvedValue({ status: 'ok', draft: draftRow({ greeting_text: 'mine' }, 3) });
    await saveDraftContent(txDb, { content: { greeting_text: 'mine' }, expected_revision: 2 }, 'admin');
    expect(vi.mocked(repo.saveDraft).mock.calls[0]![0]).toBe(tx);
    expect(repo.insertAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'agent.draft.save', after_ref: 'draft@3' }));
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

const ctx = { requestId: 'r', traceId: 't' };
const release = (id: string, version: number, content: Record<string, unknown>) => ({
  id, version, content, content_hash: computeContentHash(content), draft_revision: 1, note: null, created_by: 'admin', created_at: at,
});
const active = (releaseId: string, revision = 1) => ({ id: 'default', release_id: releaseId, revision, updated_by: 'admin', updated_at: at });

describe('publish', () => {
  beforeEach(() => {
    vi.mocked(repo.findIdempotencyRecordForAgent).mockResolvedValue(undefined);
    vi.mocked(repo.withAgentLock).mockImplementation((_db, _scope, _key, work) => work(db as never));
    setAgentValidator(async content => ({ valid: true, content_hash: computeContentHash(content), issues: [] }));
  });

  it('creates the next version, moves the pointer and audits in one unit', async () => {
    const v1 = release('agr_1', 1, { greeting_text: 'a' });
    vi.mocked(repo.getDraft).mockResolvedValue(draftRow({ greeting_text: 'b' }, 2));
    vi.mocked(repo.lockActive).mockResolvedValue(active('agr_1'));
    vi.mocked(repo.findRelease).mockResolvedValue(v1);
    vi.mocked(repo.insertRelease).mockResolvedValue(release('agr_2', 2, { greeting_text: 'b' }));
    vi.mocked(repo.pointActive).mockResolvedValue(active('agr_2', 2));
    const res = await publish(db, { expected_draft_revision: 2, expected_active_revision: 1, idempotency_key: 'publish-0001' }, 'admin', ctx);
    expect(res).toMatchObject({ status: 201, data: { id: 'agr_2', version: 2, is_active: true } });
    expect(repo.insertAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'agent.release.publish', before_ref: 'agr_1', after_ref: 'agr_2' }));
  });

  it('refuses an invalid draft with the runtime issues', async () => {
    vi.mocked(repo.getDraft).mockResolvedValue(draftRow({ greeting_text: '' }, 2));
    setAgentValidator(async () => ({ valid: false, content_hash: 'h', issues: [{ path: 'greeting_text', code: 'string_too_short', message: 'x' }] }));
    await expect(publish(db, { expected_draft_revision: 2, expected_active_revision: 1, idempotency_key: 'publish-0002' }, 'admin', ctx))
      .rejects.toMatchObject({ status: 422, code: 'PUBLISH_GATE_FAILED', details: { issues: [{ path: 'greeting_text' }] } });
    expect(repo.insertRelease).not.toHaveBeenCalled();
  });

  it('409s on unchanged content and on a moved pointer', async () => {
    vi.mocked(repo.getDraft).mockResolvedValue(draftRow({ greeting_text: 'a' }, 2));
    vi.mocked(repo.lockActive).mockResolvedValue(active('agr_1'));
    vi.mocked(repo.findRelease).mockResolvedValue(release('agr_1', 1, { greeting_text: 'a' }));
    await expect(publish(db, { expected_draft_revision: 2, expected_active_revision: 1, idempotency_key: 'publish-0003' }, 'admin', ctx))
      .rejects.toMatchObject({ status: 409, code: 'CONFLICT_INVALID_STATE', details: { kind: 'no_changes' } });
    vi.mocked(repo.lockActive).mockResolvedValue(active('agr_1', 5));
    await expect(publish(db, { expected_draft_revision: 2, expected_active_revision: 1, idempotency_key: 'publish-0004' }, 'admin', ctx))
      .rejects.toMatchObject({ status: 409, code: 'CONFLICT_REVISION' });
  });

  it('never publishes when the report hash does not match the draft', async () => {
    vi.mocked(repo.getDraft).mockResolvedValue(draftRow({ greeting_text: 'b' }, 2));
    setAgentValidator(async () => ({ valid: true, content_hash: computeContentHash({ greeting_text: 'other' }), issues: [] }));
    await expect(publish(db, { expected_draft_revision: 2, expected_active_revision: 1, idempotency_key: 'publish-0005' }, 'admin', ctx))
      .rejects.toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE', details: { kind: 'hash_mismatch' } });
    expect(repo.withAgentLock).not.toHaveBeenCalled();
    expect(repo.insertRelease).not.toHaveBeenCalled();
  });
});

describe('activeDescriptor', () => {
  it('is 422 RES_EXPERIENCE_NOT_CONFIGURED when no release is active', async () => {
    vi.mocked(repo.getActive).mockResolvedValue(undefined);
    await expect(activeDescriptor(db, 'demo')).rejects.toMatchObject({ status: 422, code: 'RES_EXPERIENCE_NOT_CONFIGURED' });
  });
});

describe('restore', () => {
  beforeEach(() => {
    vi.mocked(repo.findIdempotencyRecordForAgent).mockResolvedValue(undefined);
    vi.mocked(repo.withAgentLock).mockImplementation((_db, _scope, _key, work) => work(db as never));
    setAgentValidator(async () => ({ valid: true, content_hash: 'h', issues: [] }));
  });

  it('restores an older release after re-validating it', async () => {
    vi.mocked(repo.findRelease).mockImplementation(async (_db, id) => (id === 'agr_1' ? release('agr_1', 1, { greeting_text: 'a' }) : release('agr_2', 2, { greeting_text: 'b' })));
    vi.mocked(repo.lockActive).mockResolvedValue(active('agr_2', 2));
    vi.mocked(repo.pointActive).mockResolvedValue(active('agr_1', 3));
    const res = await restore(db, 'agr_1', { expected_active_revision: 2, idempotency_key: 'restore-0001' }, 'admin', ctx);
    expect(res.data).toMatchObject({ release_id: 'agr_1', version: 1, revision: 3 });
    expect(repo.insertAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'agent.release.restore', before_ref: 'agr_2', after_ref: 'agr_1' }));
  });

  it('replays a stored result without touching state, and rejects a reused key for another release', async () => {
    const stored = { request_hash: computeContentHash({ expected_active_revision: 2, idempotency_key: 'restore-0002', release_id: 'agr_1' }),
      response_status: 200, response_body: { release_id: 'agr_1' } };
    vi.mocked(repo.findIdempotencyRecordForAgent).mockResolvedValue(stored as never);
    const res = await restore(db, 'agr_1', { expected_active_revision: 2, idempotency_key: 'restore-0002' }, 'admin', ctx);
    expect(res).toMatchObject({ status: 200, replayed: true, data: { release_id: 'agr_1' } });
    expect(repo.findRelease).not.toHaveBeenCalled();
    await expect(restore(db, 'agr_2', { expected_active_revision: 2, idempotency_key: 'restore-0002' }, 'admin', ctx))
      .rejects.toMatchObject({ status: 409, code: 'CONFLICT_IDEMPOTENCY_KEY' });
  });
});
