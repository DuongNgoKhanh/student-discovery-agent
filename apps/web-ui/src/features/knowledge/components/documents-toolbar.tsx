'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DOCUMENT_STATES, type DocumentState } from '../hooks/use-document-filters';

export interface DocumentsToolbarProps {
  q: string;
  state: DocumentState;
  onQChange: (q: string) => void;
  onStateChange: (state: DocumentState) => void;
  actions?: React.ReactNode;
}

export function DocumentsToolbar({ q, state, onQChange, onStateChange, actions }: DocumentsToolbarProps) {
  const [text, setText] = useState(q);
  const sent = useRef(q);
  const onQChangeRef = useRef(onQChange);
  onQChangeRef.current = onQChange;
  // Follow outside changes of `q` (e.g. "Xoá bộ lọc"), not the echo of our own debounced write.
  useEffect(() => { if (q !== sent.current) { sent.current = q; setText(q); } }, [q]);
  useEffect(() => {
    if (text === sent.current) return;
    const timer = setTimeout(() => { sent.current = text; onQChangeRef.current(text); }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={text} onChange={event => setText(event.target.value)} placeholder="Tìm theo tên"
          aria-label="Tìm tài liệu" className="pl-8" maxLength={200} />
      </div>
      <Select value={state} onValueChange={value => onStateChange(value as DocumentState)}>
        <SelectTrigger className="w-40" aria-label="Lọc theo trạng thái"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(DOCUMENT_STATES).map(([value, { label }]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
