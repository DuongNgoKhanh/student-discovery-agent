'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearchKnowledge } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';

export function SearchTab({ kb }: { kb: string }) {
  const search = useSearchKnowledge();
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(4);
  return (
    <div className="space-y-3 text-sm">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search.mutate({ kb, body: { query, top_k: topK } }); }}>
        <Input placeholder="Ví dụ: học phí HUTECH" value={query} onChange={e => setQuery(e.target.value)} />
        <Input className="w-20" type="number" min={1} max={20} value={topK} onChange={e => setTopK(Number(e.target.value))} aria-label="top_k" />
        <Button type="submit" disabled={!query.trim() || search.isPending}>Tìm</Button>
      </form>
      <p className="text-gray-600">Chỉ tìm trong revision agent đang dùng; document vừa sửa chỉ xuất hiện sau khi index xong.</p>
      <ErrorText error={search.error} />
      {search.data?.degraded && <p className="text-amber-700">Đang chỉ tìm theo từ khoá (embedding câu hỏi lỗi).</p>}
      {search.data?.records.length === 0 && <p>Không có kết quả trên ngưỡng.</p>}
      <ol className="space-y-3">
        {search.data?.records.map((record, index) => (
          <li key={index} className="rounded-md border p-3">
            <p className="font-semibold">{record.title} <span className="font-normal text-gray-600">· score {record.score.toFixed(3)}</span></p>
            <p className="text-xs text-gray-600">{`document ${String(record.metadata.document_id ?? '?')} · revision ${String(record.metadata.revision ?? '?')}`}</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">{record.content}</pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
