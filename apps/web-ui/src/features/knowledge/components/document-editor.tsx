'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { useDocument, useFields, usePutDocument } from '../hooks/use-knowledge';
import type { DocumentDetail, MetadataField } from '../types';
import { DocumentEditorInfo } from './document-editor-info';
import {
  BODY_MAX_BYTES, FORM_FIELDS, derivedId, documentIdOf, editorSchema, formatKb, issueText, serverIssues, utf8Bytes,
  type EditorForm, type EditorSchemaContext,
} from './document-editor-form';
import { ErrorText } from './error-text';
import { kbHref } from './kb-routes';
import { MarkdownPreview } from './markdown-preview';
import { fromFormValues, toFormValues } from './metadata-form';
import { MetadataInputs, fieldLabel } from './metadata-inputs';
import { ConfirmDialog } from './shared/confirm-dialog';
import { CopyButton } from './shared/copy-button';
import { errorMessage } from './shared/error-message';
import { useUnsavedGuard } from './use-unsaved-guard';

const LABELS: Record<string, string> = { id: 'ID', title: 'Tiêu đề', source_url: 'Nguồn', body: 'Nội dung' };
const errorId = (name: string) => `doc-${name}-error`;

/** Field errors in form order as "label: message", for the summary shown after a failed save. */
function errorLines(errors: FieldErrors<EditorForm>, fields: MetadataField[]): string[] {
  const lines = (['id', 'title', 'source_url', 'body'] as const)
    .filter(name => errors[name]?.message).map(name => `${LABELS[name]}: ${errors[name]!.message}`);
  for (const field of fields) {
    const message = errors.metadata?.[field.name]?.message;
    if (message) lines.push(`${fieldLabel(field)}: ${message}`);
  }
  return lines;
}

function FieldError({ name, message }: { name: string; message?: string }) {
  return message ? <p id={errorId(name)} className="mt-1 text-xs text-destructive">{message}</p> : null;
}

export function DocumentEditor({ kb, docId }: { kb: string; docId: string | null }) {
  const router = useRouter();
  const fields = useFields(kb);
  const document = useDocument(kb, docId, { pollWhilePending: true });
  const save = usePutDocument();
  const [customId, setCustomId] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [editingMeta, setEditingMeta] = useState<string | null>(null);
  const [extraIssues, setExtraIssues] = useState<string[]>([]);
  const [summaryShown, setSummaryShown] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  // The resolver reads the latest fields/ID mode at validation time instead of being rebuilt every render.
  const schemaContext = useRef<EditorSchemaContext>({ fields: [], isNew: docId === null, customId });
  useEffect(() => { schemaContext.current = { fields: fields.data ?? [], isNew: docId === null, customId }; });
  const form = useForm<EditorForm>({
    defaultValues: { id: '', title: '', body: '', source_url: '', metadata: {} },
    mode: 'onBlur',
    shouldFocusError: false,
    resolver: (values, context, options) => zodResolver(editorSchema(schemaContext.current))(values, context, options),
  });
  const { errors, isDirty } = form.formState;
  const [title, body] = useWatch({ control: form.control, name: ['title', 'body'] });
  const guard = useUnsavedGuard(isDirty);

  const detail = document.data;
  // The revision the form was loaded from: saves send it, so a newer revision elsewhere surfaces as a 409.
  const baseRevision = useRef(0);
  const loadedKey = useRef<string | null>(null);
  const resetForm = (fieldList: MetadataField[], source: DocumentDetail | undefined) => {
    baseRevision.current = source?.revision ?? 0;
    loadedKey.current = `${docId ?? ''}:${source?.latest.revision ?? ''}`;
    form.reset({
      id: docId ?? '', title: source?.latest.title ?? '', body: source?.latest.body ?? '',
      source_url: source?.latest.source_url ?? '', metadata: toFormValues(fieldList, source?.latest.metadata ?? {}),
    });
  };

  // Reset only when a different document/revision arrives, so refetches (and polling) never discard typed text;
  // a newer revision of the same document over unsaved edits is left for the 409 banner to resolve.
  useEffect(() => {
    if (!fields.data || (docId && !detail)) return;
    const key = `${docId ?? ''}:${detail?.latest.revision ?? ''}`;
    if (loadedKey.current === key) return;
    if (isDirty && loadedKey.current?.startsWith(`${docId ?? ''}:`)) return;
    resetForm(fields.data, detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetForm only closes over docId and form
  }, [fields.data, detail, docId, isDirty, form]);

  const isConflict = save.error instanceof ApiError && save.error.httpStatus === 409;
  const conflict = isConflict && !!docId;
  const idTaken = isConflict && !docId;
  const otherError = save.error && !isConflict && !(save.error instanceof ApiError && save.error.httpStatus === 422) ? save.error : null;

  const openIdInput = () => {
    if (customId) return;
    form.setValue('id', derivedId(form.getValues('title')));
    setCustomId(true);
  };

  const showSummary = () => setSummaryShown(count => count + 1);
  useEffect(() => { if (summaryShown > 0) summaryRef.current?.focus(); }, [summaryShown]);

  const reloadLatest = async () => {
    save.reset();
    const result = await document.refetch();
    if (fields.data && result.data) resetForm(fields.data, result.data);
  };

  const applyServerIssues = (error: unknown) => {
    const issues = serverIssues(error);
    if (!(error instanceof ApiError && error.httpStatus === 422)) return;
    const known = new Set((fields.data ?? []).map(field => `metadata.${field.name}`));
    const unmapped: string[] = [];
    for (const issue of issues) {
      const path = issue.path ?? '';
      if ((FORM_FIELDS as readonly string[]).includes(path) || known.has(path)) {
        form.setError(path as FieldPath<EditorForm>, { type: 'server', message: issueText(issue) });
      } else {
        unmapped.push(path ? `${path}: ${issueText(issue)}` : issueText(issue));
      }
    }
    setExtraIssues(issues.length === 0 ? [errorMessage(error)] : unmapped);
    showSummary();
  };

  // mutate, not mutateAsync: API errors render through save.error instead of escaping as rejections.
  const submit = form.handleSubmit(values => {
    if (save.isPending) return;
    setSummaryShown(0);
    setExtraIssues([]);
    const { metadata } = fromFormValues(fields.data ?? [], values.metadata);
    const doc = docId ?? documentIdOf(values, customId);
    save.mutate({
      kb, doc,
      body: {
        title: values.title, body: values.body, source_url: values.source_url.trim() || null, metadata,
        expected_revision: baseRevision.current,
      },
    }, {
      onSuccess: result => {
        // What was sent is now the saved state; the refetch of this revision must not reset over newer typing.
        baseRevision.current = result.revision;
        loadedKey.current = `${docId ?? ''}:${result.revision}`;
        // keepValues: text typed while the request was in flight stays, and isDirty is recomputed against the saved values.
        form.reset(values, { keepValues: true });
        toast.success(result.outcome === 'unchanged' ? 'Không có thay đổi' : `Đã lưu r${result.revision}`);
        if (!docId) router.replace(`/admin/knowledge/${kb}/documents/${doc}`);
      },
      onError: error => {
        if (error instanceof ApiError && error.httpStatus === 409 && !docId) openIdInput();
        applyServerIssues(error);
      },
    });
  }, invalid => {
    if (invalid.id && !invalid.title) openIdInput();
    setExtraIssues([]);
    showSummary();
  });

  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void submitRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link href={kbHref(kb, 'documents')} className="inline-flex items-center gap-1 rounded-md text-13 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="h-4 w-4" aria-hidden />Tài liệu
      </Link>
      <div className="flex items-center gap-3">
        {isDirty && (
          <span className="inline-flex items-center gap-1.5 text-13 text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-warning" />Chưa lưu
          </span>
        )}
        <Button
          type="button" onClick={() => void submit()} disabled={save.isPending || !fields.data}
          title="Lưu (Ctrl+S)" aria-keyshortcuts="Control+S Meta+S"
        >
          Lưu
        </Button>
      </div>
    </div>
  );

  if (fields.isLoading || (docId && document.isLoading)) {
    return (
      <>
        {header}
        <div aria-busy="true" aria-label="Đang tải" className="space-y-3">
          <Skeleton className="h-10 w-2/3" /><Skeleton className="h-6 w-1/2" /><Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  if (fields.error || document.error) return <>{header}<ErrorText error={fields.error ?? document.error} /></>;

  const fieldList = fields.data ?? [];
  const bytes = utf8Bytes(body ?? '');
  const summary = summaryShown > 0 ? [...errorLines(errors, fieldList), ...extraIssues] : [];
  const autoId = derivedId(title ?? '');
  const describe = (name: string, extra?: string) => [errors[name as keyof EditorForm] ? errorId(name) : undefined, extra]
    .filter(Boolean).join(' ') || undefined;

  return (
    <div>
      {header}
      {conflict && (
        <div role="alert" className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-status-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-[14rem] flex-1">Tài liệu đã bị sửa ở nơi khác. Nội dung của bạn chưa được lưu.</p>
          <CopyButton
            size="sm" label="Copy nội dung của tôi"
            value={() => { const values = form.getValues(); return `# ${values.title}\n\n${values.body}`; }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void reloadLatest()}>
            Tải bản mới (bỏ nội dung đang soạn)
          </Button>
        </div>
      )}
      {summary.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="mb-4 rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="font-medium">Chưa lưu được, hãy sửa {summary.length} lỗi:</p>
          <ul className="mt-1 list-disc pl-5">{summary.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {otherError && <div className="mb-4"><ErrorText error={otherError} /></div>}

      <form onSubmit={event => void submit(event)} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <Input
            aria-label="Tiêu đề" placeholder="Tiêu đề tài liệu" autoComplete="off"
            aria-invalid={!!errors.title} aria-describedby={describe('title')}
            className="-mx-2 h-auto border-transparent px-2 py-1 text-2xl font-semibold leading-9 shadow-none placeholder:text-muted-foreground/60 hover:border-border focus-visible:border-input"
            {...form.register('title')}
          />
          <FieldError name="title" message={errors.title?.message} />

          <div className="mt-1 text-xs text-muted-foreground">
            {docId
              ? <p><span className="font-mono">ID: {docId}</span></p>
              : customId
                ? (
                  <div className="mt-2 max-w-sm">
                    <label htmlFor="doc-id" className="mb-1 block text-xs font-medium text-foreground">ID tài liệu</label>
                    <Input
                      id="doc-id" autoComplete="off" spellCheck={false} className="h-8 font-mono text-13"
                      aria-invalid={!!errors.id || idTaken} aria-describedby={errors.id || idTaken ? errorId('id') : undefined}
                      {...form.register('id', { onChange: () => { if (idTaken) save.reset(); } })}
                    />
                    <FieldError name="id" message={idTaken ? 'ID đã tồn tại, hãy chọn ID khác.' : errors.id?.message} />
                  </div>
                )
                : (
                  <p className="flex items-center gap-2">
                    <span className="font-mono">ID: {autoId || '—'}</span>
                    <button type="button" className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={openIdInput}>
                      Đổi ID
                    </button>
                  </p>
                )}
          </div>

          <Input
            aria-label="Nguồn" placeholder="Nguồn: https://..." type="url" autoComplete="off"
            aria-invalid={!!errors.source_url} aria-describedby={describe('source_url')}
            className="-mx-2 mt-2 h-8 border-transparent px-2 text-sm text-muted-foreground shadow-none hover:border-border focus-visible:border-input focus-visible:text-foreground"
            {...form.register('source_url')}
          />
          <FieldError name="source_url" message={errors.source_url?.message} />

          <hr className="my-4 border-border" />

          <div className="mb-3 flex items-center justify-between gap-3">
            <div role="group" aria-label="Chế độ" className="inline-flex rounded-md border bg-sidebar p-0.5">
              {([['write', 'Soạn'], ['preview', 'Xem trước']] as const).map(([value, label]) => (
                <button
                  key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
                  className={cn(
                    'rounded px-3 py-1 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    mode === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <span
              id="doc-body-size" title="Dung lượng nội dung (UTF-8)"
              className={cn(
                'text-xs tabular-nums',
                bytes > BODY_MAX_BYTES ? 'font-medium text-destructive'
                  : bytes >= BODY_MAX_BYTES * 0.9 ? 'text-warning-foreground' : 'text-muted-foreground',
              )}
            >
              {formatKb(bytes)} / 256 KB
            </span>
          </div>

          <Textarea
            aria-label="Nội dung (Markdown)" placeholder="Viết nội dung bằng Markdown…"
            aria-invalid={!!errors.body} aria-describedby={describe('body', 'doc-body-size')}
            className={cn('-mx-2 min-h-[60vh] resize-y border-transparent px-2 font-sans text-base leading-7 shadow-none focus-visible:border-input', mode === 'preview' && 'hidden')}
            {...form.register('body')}
          />
          {mode === 'preview' && <MarkdownPreview source={body ?? ''} className="min-h-[60vh] py-2" />}
          <FieldError name="body" message={errors.body?.message} />
        </div>

        <aside className="order-first border-b pb-6 lg:order-none lg:sticky lg:top-6 lg:self-start lg:border-b-0 lg:border-l lg:pb-0 lg:pl-6">
          <DocumentEditorInfo kb={kb} detail={detail}>
            <MetadataInputs fields={fieldList} control={form.control} editing={editingMeta} onEditingChange={setEditingMeta} />
          </DocumentEditorInfo>
        </aside>
      </form>

      <ConfirmDialog
        {...guard}
        title="Rời trang khi chưa lưu?" description="Nội dung bạn đang soạn sẽ mất."
        confirmLabel="Rời trang" cancelLabel="Ở lại" destructive
      />
    </div>
  );
}
