'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useCommitImport, useFields, usePreviewImport } from '../hooks/use-knowledge';
import type { ImportPreviewRequest, ImportPreviewRow } from '../types';
import { autoMapColumns } from './auto-map-columns';
import { csvFirstRow, csvHeader, csvRowCount } from './csv-header';
import { ErrorText } from './error-text';
import { ImportFileStep } from './import-file-step';
import { checkFiles, MAX_ROWS, readText } from './import-files';
import { BASE_TARGETS, ImportMappingStep, mappingTargets, metaKey } from './import-mapping-step';
import { ImportPreviewTable, ImportResult } from './import-review-step';
import { type ImportStep, ImportStepper } from './import-stepper';
import { kbHref } from './kb-routes';

const READ_ERROR = 'Không đọc được file, hãy thử lại.';

type WritableRow = ImportPreviewRow & { document_id: string; expected_revision: number; payload: NonNullable<ImportPreviewRow['payload']> };

export function ImportTab({ kb }: { kb: string }) {
  const fields = useFields(kb);
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const [step, setStep] = useState<ImportStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [csv, setCsv] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [importKey, setImportKey] = useState('');
  const [readError, setReadError] = useState<Error | null>(null);
  // Ignores a CSV read that finishes after the selection changed again.
  const readSeq = useRef(0);

  const { mode, errors } = checkFiles(files);
  // Parsing a large CSV is not free; do it once per file instead of on every render.
  const parsed = useMemo(() => (csv === null ? null : { header: csvHeader(csv), sample: csvFirstRow(csv), rows: csvRowCount(csv) }), [csv]);
  const csvRows = mode === 'csv' && parsed ? parsed.rows : 0;
  const csvErrors = mode !== 'csv' || !parsed ? []
    : parsed.header.length === 0 ? [`${files[0]!.name}: không có dòng tiêu đề.`]
      : csvRows > MAX_ROWS ? [`${files[0]!.name}: có ${csvRows} dòng dữ liệu, tối đa ${MAX_ROWS} dòng mỗi lần nhập.`] : [];
  const fileErrors = [...errors, ...csvErrors];
  const ready = mode === 'files' || (mode === 'csv' && csv !== null && csvErrors.length === 0);
  const writable = (preview.data?.rows ?? []).filter((row): row is WritableRow => row.action === 'create' || row.action === 'update');

  // Any input change drops the old preview so the admin cannot commit rows that no longer match the inputs.
  function invalidatePreview() {
    preview.reset();
    commit.reset();
    setReadError(null);
  }

  function changeFiles(next: File[]) {
    invalidatePreview();
    setFiles(next);
    setCsv(null);
    setMapping(null);
    const seq = ++readSeq.current;
    const checked = checkFiles(next);
    if (checked.mode !== 'csv') return;
    readText(next[0]!).then((text) => {
      if (seq !== readSeq.current) return;
      setCsv(text);
    }).catch(() => { if (seq === readSeq.current) setReadError(new Error(READ_ERROR)); });
  }

  function changeMapping(key: string, column: string | undefined) {
    invalidatePreview();
    setMapping((current) => {
      const next = { ...current };
      if (column === undefined) delete next[key];
      else next[key] = column;
      return next;
    });
  }

  // Auto-map once per CSV, on first entering the mapping step (gated on the fields being loaded), so later edits stay.
  function goToMapping() {
    if (!fields.data) return;
    if (mapping === null && parsed) setMapping(autoMapColumns(parsed.header, mappingTargets(fields.data)));
    setStep(2);
  }
  const waitingFields = mode === 'csv' && !fields.data;

  async function runPreview() {
    invalidatePreview();
    try {
      let body: ImportPreviewRequest;
      if (mode === 'files') {
        body = { kind: 'files', files: await Promise.all(files.map(async file => ({ name: file.name, content: await readText(file) }))) };
      } else {
        const map = mapping ?? {};
        const base = Object.fromEntries(BASE_TARGETS.flatMap(({ key }) => (map[key] ? [[key, map[key]]] : [])));
        const metadata = Object.fromEntries((fields.data ?? []).flatMap(field => (map[metaKey(field.name)] ? [[field.name, map[metaKey(field.name)]!]] : [])));
        body = { kind: 'csv', content: csv ?? '', mapping: { ...base, metadata } };
      }
      // One key per preview, so pressing commit twice replays the stored report instead of writing again.
      setImportKey(crypto.randomUUID());
      preview.mutate({ kb, body });
    } catch {
      setReadError(new Error(READ_ERROR));
    }
  }

  function goToReview() {
    setStep(3);
    void runPreview();
  }

  function runCommit() {
    commit.mutate(
      { kb, body: { idempotency_key: importKey, rows: writable.map(({ row, document_id, expected_revision, payload }) => ({ row, document_id, expected_revision, payload })) } },
      { onSuccess: report => toast.success(`Đã ghi xong: ${report.created} tạo, ${report.updated} sửa.`) },
    );
  }

  function restart() {
    readSeq.current++;
    invalidatePreview();
    setFiles([]);
    setCsv(null);
    setMapping(null);
    setImportKey('');
    setStep(1);
  }

  const footer = (children: React.ReactNode) => <div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div>;
  const back = (to: ImportStep) => <Button type="button" variant="outline" onClick={() => setStep(to)}>Quay lại</Button>;

  return (
    <div className="text-sm">
      <ImportStepper current={step} skipMapping={mode === 'files'} />

      {step === 1 && (
        <>
          <ImportFileStep files={files} errors={fileErrors} onAdd={added => changeFiles([...files, ...added])} onRemove={index => changeFiles(files.filter((_, i) => i !== index))} />
          <ErrorText error={readError} />
          {mode === 'csv' && <ErrorText error={fields.error} />}
          {footer(
            <>
              {waitingFields && fields.isLoading && <span role="status" className="self-center text-13 text-muted-foreground">Đang tải metadata…</span>}
              <Button type="button" disabled={!ready || waitingFields} onClick={() => (mode === 'csv' ? goToMapping() : goToReview())}>Tiếp tục</Button>
            </>,
          )}
        </>
      )}

      {step === 2 && parsed && (
        <>
          <ImportMappingStep header={parsed.header} sample={parsed.sample} fields={fields.data ?? []} mapping={mapping ?? {}} onChange={changeMapping} />
          {footer(<>{back(1)}<Button type="button" onClick={goToReview}>Tiếp tục</Button></>)}
        </>
      )}

      {step === 3 && (
        <>
          <ErrorText error={readError} />
          <ErrorText error={preview.error} />
          {preview.isPending && <p role="status" className="py-8 text-center text-13 text-muted-foreground">Đang xem trước…</p>}
          {commit.data
            ? <ImportResult kb={kb} report={commit.data} />
            : preview.data && <ImportPreviewTable key={importKey} rows={preview.data.rows} />}
          <div className="mt-3"><ErrorText error={commit.error} /></div>
          {commit.data
            ? footer(
              <>
                <Button type="button" variant="outline" onClick={restart}>Nhập tiếp</Button>
                <Button asChild><Link href={kbHref(kb, 'documents')}>Về danh sách tài liệu</Link></Button>
              </>,
            )
            : footer(
              <>
                {back(mode === 'csv' ? 2 : 1)}
                <Button type="button" variant="outline" disabled={preview.isPending || commit.isPending} onClick={() => void runPreview()}>
                  <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />Xem trước lại
                </Button>
                <Button type="button" disabled={!preview.data || writable.length === 0 || commit.isPending} onClick={runCommit}>
                  {`Ghi ${writable.length} tài liệu`}
                </Button>
              </>,
            )}
        </>
      )}
    </div>
  );
}
