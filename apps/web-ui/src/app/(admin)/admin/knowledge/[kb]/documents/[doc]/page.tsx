'use client';

import { useParams } from 'next/navigation';
import { DocumentEditor } from '@/features/knowledge';

export default function KnowledgeDocumentPage() {
  const params = useParams<{ kb: string; doc: string }>();
  const kb = decodeURIComponent(params.kb);
  const docId = params.doc === 'new' ? null : decodeURIComponent(params.doc);
  return <DocumentEditor kb={kb} docId={docId} />;
}
