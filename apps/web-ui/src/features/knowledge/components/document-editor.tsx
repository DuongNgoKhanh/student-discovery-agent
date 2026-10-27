'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';
import {
  useArchiveDocument, useDocument, useFields, usePutDocument, useRestoreDocument, useRetryRevision,
} from '../hooks/use-knowledge';
import { ErrorText } from './error-text';
import { IndexStatusBadge } from './index-status-badge';
import { fromFormValues, toFormValues } from './metadata-form';

type EditorForm = { id: string; title: string; body: string; source_url: string; metadata: Record<string, string> };

export function DocumentEditor({ kb, docId }: { kb: string; docId: string | null }) {
  const router = useRouter();
  const fields = useFields(kb);
  const document = useDocument(kb, docId);
  const save = usePutDocument();
  const archive = useArchiveDocument();
  const restore = useRestoreDocument();
  const retry = useRetryRevision();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const form = useForm<EditorForm>({ defaultValues: { id: '', title: '', body: '', source_url: '', metadata: {} } });

  const latest = document.data?.latest;
  useEffect(() => {
    if (!fields.data || (docId && !latest)) return;
    form.reset({
      id: docId ?? '', title: latest?.title ?? '', body: latest?.body ?? '', source_url: latest?.source_url ?? '',
      metadata: toFormValues(fields.data, latest?.metadata ?? {}),
    });
  }, [fields.data, latest, docId, form]);

  const conflict = save.error instanceof ApiError && save.error.httpStatus === 409 && save.error.code === 'CONFLICT_REVISION';

  // mutate, not mutateAsync: API errors render through save.error instead of escaping as rejections.
  const submit = form.handleSubmit(values => {
    const { metadata, errors } = fromFormValues(fields.data ?? [], values.metadata);
    setFormErrors(errors);
    if (errors.length > 0) return;
    const doc = docId ?? values.id.trim();
    save.mutate({
      kb, doc,
      body: {
        title: values.title, body: values.body, source_url: values.source_url.trim() || null, metadata,
        expected_revision: document.data?.revision ?? 0,
      },
    }, { onSuccess: () => { if (!docId) router.replace(`/admin/knowledge/${kb}/documents/${doc}`); } });
  });

  if (fields.isLoading || (docId && document.isLoading)) return <p>Đang tải...</p>;
  if (fields.error || document.error) return <ErrorText error={fields.error ?? document.error} />;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
      <form onSubmit={submit} className="space-y-3">
        {!docId && (
          <label className="block text-sm">Document ID
            <Input {...form.register('id', { required: true })} />
          </label>
        )}
        <label className="block text-sm">Tiêu đề
          <Input {...form.register('title', { required: true })} />
        </label>
        <label className="block text-sm">Source URL
          <Input {...form.register('source_url')} placeholder="https://..." />
        </label>
        <label className="block text-sm">Nội dung (Markdown)
          <Textarea rows={20} {...form.register('body')} />
        </label>
        {fields.data?.map(field => (
          <label key={field.id} className="block text-sm">{`${field.label || field.name} (${field.name})`}
            <Input
              type={field.type === 'time' ? 'date' : 'text'}
              placeholder={field.type === 'string_list' ? 'giá trị 1; giá trị 2' : undefined}
              {...form.register(`metadata.${field.name}`)}
            />
          </label>
        ))}
        {formErrors.length > 0 && <ErrorText error={new Error(formErrors.join(', '))} />}
        {conflict
          ? (
            <div role="alert" className="text-sm text-red-600">
              Tài liệu đã bị sửa ở nơi khác. Nội dung của bạn chưa được lưu.{' '}
              <button type="button" className="underline" onClick={() => { save.reset(); void document.refetch(); }}>
                Tải bản mới (bỏ nội dung đang soạn)
              </button>
            </div>
          )
          : <ErrorText error={save.error} />}
        {save.data && <p className="text-sm text-green-700">Đã lưu: revision {save.data.revision} ({save.data.outcome}).</p>}
        <Button type="submit" disabled={save.isPending}>Lưu</Button>
      </form>
      {document.data && (
        <aside className="space-y-2 text-sm">
          <p>Trạng thái: {document.data.status === 'archived' ? 'Đã archive' : 'Đang dùng'}</p>
          <p>Revision mới nhất: {document.data.latest.revision} <IndexStatusBadge status={document.data.latest.index_status} /></p>
          <p>Revision agent đang dùng: {document.data.active?.revision ?? 'chưa có'}</p>
          {document.data.latest.error && <p className="text-red-600">Lỗi index: {document.data.latest.error}</p>}
          <Button type="button" variant="outline" onClick={() => void document.refetch()}>Làm mới</Button>
          {document.data.latest.index_status === 'error' && (
            <Button type="button" variant="outline" disabled={retry.isPending}
              onClick={() => retry.mutate({ kb, doc: document.data!.id, revision: document.data!.latest.revision })}>
              Thử index lại
            </Button>
          )}
          {document.data.status === 'active'
            ? <Button type="button" variant="destructive" onClick={() => archive.mutate({ kb, doc: document.data!.id, expected_revision: document.data!.revision })}>Archive</Button>
            : <Button type="button" variant="outline" onClick={() => restore.mutate({ kb, doc: document.data!.id, expected_revision: document.data!.revision })}>Khôi phục</Button>}
          <ErrorText error={retry.error ?? archive.error ?? restore.error} />
        </aside>
      )}
    </div>
  );
}
