'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateKnowledgeBase, useKnowledgeBases } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';

type CreateForm = { name: string; id: string; embedding_model: string };

export function KnowledgeBaseList() {
  const { data, isLoading, error } = useKnowledgeBases();
  const create = useCreateKnowledgeBase();
  const form = useForm<CreateForm>({ defaultValues: { name: '', id: '', embedding_model: 'gemini-embedding-2' } });

  const submit = form.handleSubmit(values => {
    create.mutate(
      { name: values.name, embedding_model: values.embedding_model, ...(values.id ? { id: values.id } : {}) },
      { onSuccess: () => form.reset() },
    );
  });

  return (
    <div className="space-y-6">
      {isLoading && <p>Đang tải...</p>}
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>Tên</th><th>ID</th><th>Model</th><th>Documents</th><th>Lỗi index</th></tr></thead>
        <tbody>
          {data?.map(kb => (
            <tr key={kb.id} className="border-t">
              <td><Link className="underline" href={`/admin/knowledge/${kb.id}`}>{kb.name}</Link></td>
              <td>{kb.id}</td>
              <td>{kb.embedding_model}</td>
              <td>{kb.document_count}</td>
              <td>{kb.error_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p>Chưa có knowledge base nào.</p>}
      <form onSubmit={submit} className="space-y-2 rounded-md border p-4">
        <h2 className="font-semibold">Tạo knowledge base</h2>
        <Input placeholder="Tên" {...form.register('name', { required: true })} />
        <Input placeholder="ID (để trống thì lấy theo tên)" {...form.register('id')} />
        <select className="h-9 rounded-md border px-2 text-sm" {...form.register('embedding_model')}>
          <option value="gemini-embedding-2">gemini-embedding-2</option>
          <option value="fake-embedding">fake-embedding (local, không có key)</option>
        </select>
        <ErrorText error={create.error} />
        <Button type="submit" disabled={create.isPending}>Tạo</Button>
      </form>
    </div>
  );
}
