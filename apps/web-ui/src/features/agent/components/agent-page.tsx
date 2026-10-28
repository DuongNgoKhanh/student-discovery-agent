'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ConfirmDialog, PageTitle, QueryState, errorMessage, useUnsavedGuard } from '@/features/knowledge';
import { ApiError } from '@/lib/api/errors';
import { setIn, type Path } from '../model/config';
import type { SectionId } from '../model/sections';
import { useAgentActive, useAgentDraft, useSaveDraft, useValidateDraft } from '../hooks/use-agent';
import type { AgentConfig, AgentDraft } from '../types';
import { AgentStatusBar, type DraftState } from './agent-status-bar';
import { ConfigTab } from './config-tab';
import type { ValidationState } from './issues-panel';
import { PublishDialog } from './publish-dialog';
import { VersionsTab } from './versions-tab';

export function AgentPage() {
  const draft = useAgentDraft();
  return (
    <div className="space-y-4">
      <PageTitle title="Agent" description="Cấu hình trợ lý tư vấn: lời chào, persona, model và công cụ." />
      <QueryState query={draft}>{data => <AgentEditor draft={data} />}</QueryState>
    </div>
  );
}

function AgentEditor({ draft }: { draft: AgentDraft }) {
  const params = useSearchParams();
  const active = useAgentActive();
  const save = useSaveDraft();
  const validate = useValidateDraft();
  const [base, setBase] = useState(draft);           // last server copy we edited from
  const [config, setConfig] = useState<AgentConfig>(draft.content);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>(params.get('section') === 'tools' ? 'tools' : 'persona');
  const [tab, setTab] = useState<'config' | 'versions'>('config');
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [conflict, setConflict] = useState<AgentDraft | null>(null);
  const [publishing, setPublishing] = useState(false);

  const dirty = JSON.stringify(config) !== JSON.stringify(base.content);
  const guard = useUnsavedGuard(dirty);
  const draftState: DraftState = dirty ? 'unsaved' : base.content_hash === active.data?.content_hash ? 'same' : 'differs';

  const change = useCallback((path: Path, value: unknown) => {
    setConfig(current => setIn(current, path, value));
    setValidation(v => (v ? { ...v, stale: true } : v));
  }, []);

  const persist = async (): Promise<AgentDraft | null> => {
    if (!dirty) return base;
    try {
      const saved = await save.mutateAsync({ content: config, expected_revision: base.revision });
      setBase(saved); setConflict(null);
      return saved;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT_REVISION') {
        setConflict((error.details as { current?: AgentDraft } | undefined)?.current ?? null);
      } else toast.error(errorMessage(error));
      return null;
    }
  };

  const runValidation = async () => {
    if (jsonError) return;
    if (!(await persist())) return;
    try {
      const report = await validate.mutateAsync();
      setValidation({ issues: report.issues, valid: report.valid, checkedAt: new Date().toISOString(), stale: false });
    } catch (error) { toast.error(errorMessage(error)); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void persist(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-4">
      <AgentStatusBar active={active.data} draftState={draftState} busy={save.isPending || validate.isPending || Boolean(jsonError)}
        onSave={() => void persist()} onValidate={() => void runValidation()} onPublish={() => setPublishing(true)} />

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-foreground/30 bg-warning-subtle px-4 py-3 text-13">
          Bản nháp đã được sửa ở nơi khác (revision {conflict.revision}).
          <button type="button" className="underline" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(config, null, 2)); toast.success('Đã copy nội dung của bạn'); }}>Copy nội dung của tôi</button>
          <button type="button" className="underline" onClick={() => { setBase(conflict); setConfig(conflict.content); setConflict(null); }}>Tải bản mới</button>
        </div>
      )}

      <div role="tablist" className="flex gap-4 border-b text-sm">
        {(['config', 'versions'] as const).map(id => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            className={tab === id ? 'border-b-2 border-primary pb-2 font-medium' : 'pb-2 text-muted-foreground'}>
            {id === 'config' ? 'Cấu hình' : 'Phiên bản'}
          </button>
        ))}
      </div>

      {tab === 'config' ? (
        <ConfigTab config={config} onChange={change} onReplace={next => { setConfig(next); setValidation(v => (v ? { ...v, stale: true } : v)); }}
          section={section} onSection={next => { if (!jsonError) setSection(next); }} onJsonValidity={setJsonError}
          validation={validation} preselectKb={params.get('kb')} />
      ) : (
        <VersionsTab active={active.data ?? null} onCopyToDraft={content => { setConfig(content); setTab('config'); }} />
      )}

      {publishing && active.data && (
        <PublishDialog open={publishing} onOpenChange={setPublishing} draft={base} active={active.data}
          onIssues={issues => { setValidation({ issues, valid: false, checkedAt: new Date().toISOString(), stale: false }); setTab('config'); }} />
      )}

      <ConfirmDialog open={guard.open} onOpenChange={guard.onOpenChange} onConfirm={guard.onConfirm}
        title="Rời trang khi chưa lưu?" description="Các thay đổi chưa lưu sẽ mất." confirmLabel="Rời trang" destructive />
    </div>
  );
}
