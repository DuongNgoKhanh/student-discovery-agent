'use client';

import { useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ACCEPT, formatSize, MAX_BODY_BYTES, MAX_ROWS } from './import-files';

export interface ImportFileStepProps {
  files: File[];
  errors: string[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

export function ImportFileStep({ files, errors, onAdd, onRemove }: ImportFileStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onAdd([...e.dataTransfer.files]); }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary-subtle' : 'bg-sidebar',
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">Kéo thả file vào đây hoặc</p>
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>Chọn file</Button>
        <p className="max-w-md text-13 text-muted-foreground">
          {`Nhiều file .md/.txt (mỗi file một tài liệu, tối đa ${formatSize(MAX_BODY_BYTES)}) hoặc một file .csv (tối đa ${MAX_ROWS} dòng). Tổng tối đa 5 MB.`}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="File cần nhập"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => { onAdd([...(e.target.files ?? [])]); e.target.value = ''; }}
        />
      </div>

      {files.length > 0 && (
        <ul aria-label="File đã chọn" className="divide-y rounded-xl border">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2 text-13">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
              <IconButton className="h-7 w-7" label={`Bỏ ${file.name}`} tooltip="Bỏ file" onClick={() => onRemove(index)}>
                <X className="h-4 w-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-13 text-destructive">
          {errors.map(error => <li key={error}>{error}</li>)}
        </ul>
      )}
    </div>
  );
}
