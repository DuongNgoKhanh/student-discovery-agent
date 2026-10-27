'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCommitImport, useFields, usePreviewImport } from '../hooks/use-knowledge';
import type { ImportPreviewRequest, ImportPreviewRow } from '../types';
import { csvHeader } from './csv-header';
import { ErrorText } from './error-text';

type Mode = 'files' | 'csv';
const READ_ERROR = 'Không đọc được file, hãy thử lại.';
const BASE_TARGETS = ['document_id', 'title', 'body', 'source_url'] as const;

// FileReader instead of File.text(): jsdom lacks the latter and its File is not a Node Blob.
const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

export function ImportTab({ kb }: { kb: string }) {
  const fields = useFields(kb);
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const [mode, setMode] = useState<Mode>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importKey, setImportKey] = useState('');
  const [readError, setReadError] = useState<Error | null>(null);

  const columns = csvHeader(csv);
  const writable = (preview.data?.rows ?? []).filter((row): row is ImportPreviewRow & { document_id: string; expected_revision: number; payload: NonNullable<ImportPreviewRow['payload']> } =>
    row.action === 'create' || row.action === 'update');

  // Any input change drops the old preview so the admin cannot commit rows that no longer match the inputs.
  function invalidatePreview() {
    preview.reset();
    commit.reset();
    setReadError(null);
  }

  function loadCsv(file: File | undefined) {
    invalidatePreview();
    if (!file) return;
    readText(file).then((text) => {
      setCsv(text);
      setMapping({});
    }).catch(() => setReadError(new Error(READ_ERROR)));
  }

  async function runPreview() {
    invalidatePreview();
    try {
      let body: ImportPreviewRequest;
      if (mode === 'files') {
        body = { kind: 'files', files: await Promise.all(files.map(async file => ({ name: file.name, content: await readText(file) }))) };
      } else {
        const pick = (key: string) => (mapping[key] ? { [key]: mapping[key] } : {});
        const metadata = Object.fromEntries((fields.data ?? []).flatMap(field => (mapping[`meta:${field.name}`] ? [[field.name, mapping[`meta:${field.name}`]!]] : [])));
        body = { kind: 'csv', content: csv, mapping: { ...pick('document_id'), ...pick('title'), ...pick('body'), ...pick('source_url'), metadata } };
      }
      // One key per preview, so pressing commit twice replays the stored report instead of writing again.
      setImportKey(crypto.randomUUID());
      preview.mutate({ kb, body });
    } catch {
      setReadError(new Error(READ_ERROR));
    }
  }

  const select = (key: string, label: string) => (
    <label key={key} className="flex items-center gap-2 text-sm">
      <span className="w-40">{label}</span>
      <select className="h-8 rounded-md border px-2" value={mapping[key] ?? ''} onChange={(e) => { invalidatePreview(); setMapping({ ...mapping, [key]: e.target.value }); }}>
        <option value="">(không map)</option>
        {columns.map(column => <option key={column}>{column}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-4">
        <label><input type="radio" checked={mode === 'files'} onChange={() => { invalidatePreview(); setMode('files'); }} /> Markdown/TXT</label>
        <label><input type="radio" checked={mode === 'csv'} onChange={() => { invalidatePreview(); setMode('csv'); }} /> CSV</label>
      </div>
      {mode === 'files'
        ? (
          <label className="block">File Markdown/TXT
            <input type="file" multiple accept=".md,.markdown,.txt" onChange={(e) => { invalidatePreview(); setFiles([...(e.target.files ?? [])]); }} />
          </label>
        )
        : (
          <div className="space-y-2">
            <label className="block">File CSV
              <input type="file" accept=".csv,text/csv" onChange={e => loadCsv(e.target.files?.[0])} />
            </label>
            {columns.length > 0 && (
              <div className="space-y-1">
                {BASE_TARGETS.map(key => select(key, key))}
                {fields.data?.map(field => select(`meta:${field.name}`, `metadata: ${field.name}`))}
                <p className="text-gray-600">Document đã có: cột không map giữ giá trị cũ; ô rỗng trong cột được map sẽ xoá giá trị.</p>
              </div>
            )}
          </div>
        )}
      <Button onClick={() => void runPreview()} disabled={preview.isPending || (mode === 'files' ? files.length === 0 : !csv)}>Xem trước</Button>
      <ErrorText error={readError} />
      <ErrorText error={preview.error} />
      {preview.data && (
        <>
          <table className="w-full">
            <thead><tr className="text-left"><th>#</th><th>Nguồn</th><th>Document</th><th>Hành động</th><th>Lỗi</th></tr></thead>
            <tbody>
              {preview.data.rows.map(row => (
                <tr key={row.row} className={row.action === 'invalid' ? 'border-t bg-red-50' : 'border-t'}>
                  <td>{row.row}</td><td>{row.source}</td><td>{row.document_id ?? '—'}</td><td>{row.action}</td>
                  <td>{row.errors.map(error => <div key={error}>{error}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button disabled={writable.length === 0 || commit.isPending}
            onClick={() => commit.mutate({ kb, body: { idempotency_key: importKey, rows: writable.map(({ row, document_id, expected_revision, payload }) => ({ row, document_id, expected_revision, payload })) } })}>
            {`Ghi ${writable.length} dòng`}
          </Button>
        </>
      )}
      <ErrorText error={commit.error} />
      {commit.data && (
        <div className="space-y-1">
          <p>{`Tạo ${commit.data.created} · Sửa ${commit.data.updated} · Không đổi ${commit.data.unchanged} · Xung đột ${commit.data.conflict} · Lỗi ${commit.data.failed}`}</p>
          <ul className="list-disc pl-5">
            {commit.data.rows.filter(row => row.error).map(row => <li key={row.row}>{`${row.document_id}: ${row.error}`}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
