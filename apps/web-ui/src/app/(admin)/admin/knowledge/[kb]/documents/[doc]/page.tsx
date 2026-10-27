'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { DocumentEditor } from '@/features/knowledge';

export default function KnowledgeDocumentPage() {
  const { kb, doc } = useParams<{ kb: string; doc: string }>();
  const docId = doc === 'new' ? null : decodeURIComponent(doc);
  return (
    <>
      <PageHeader title={docId ?? 'Document mới'} action={<Link className="underline text-sm" href={`/admin/knowledge/${kb}`}>← Quay lại</Link>} />
      <DocumentEditor kb={kb} docId={docId} />
    </>
  );
}
