'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DocumentEditor, PageTitle, kbHref } from '@/features/knowledge';

export default function KnowledgeDocumentPage() {
  const params = useParams<{ kb: string; doc: string }>();
  const kb = decodeURIComponent(params.kb);
  const docId = params.doc === 'new' ? null : decodeURIComponent(params.doc);
  return (
    <>
      <Link href={kbHref(kb, 'documents')} className="mb-2 inline-flex items-center gap-1 text-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />Tài liệu
      </Link>
      <PageTitle title={docId ?? 'Tài liệu mới'} />
      <DocumentEditor kb={kb} docId={docId} />
    </>
  );
}
