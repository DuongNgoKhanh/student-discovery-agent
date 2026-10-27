'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useDocuments } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';
import { IndexStatusBadge } from './index-status-badge';

export function DocumentsTab({ kb }: { kb: string }) {
  const { data, isLoading, error, refetch, isFetching } = useDocuments(kb);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button asChild><Link href={`/admin/knowledge/${kb}/documents/new`}>Tạo document</Link></Button>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>Làm mới</Button>
      </div>
      {isLoading && <p>Đang tải...</p>}
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>Tiêu đề</th><th>ID</th><th>Index</th><th>Agent dùng</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>
          {data?.map(doc => (
            <tr key={doc.id} className="border-t">
              <td><Link className="underline" href={`/admin/knowledge/${kb}/documents/${doc.id}`}>{doc.title}</Link></td>
              <td>{doc.id}</td>
              <td>r{doc.revision} <IndexStatusBadge status={doc.index_status} /></td>
              <td>{doc.active_revision ? `r${doc.active_revision}` : 'chưa có'}</td>
              <td>{doc.status === 'archived' ? 'Đã archive' : 'Đang dùng'}</td>
              <td>{new Date(doc.updated_at).toLocaleString('vi-VN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p>Chưa có document nào.</p>}
    </div>
  );
}
