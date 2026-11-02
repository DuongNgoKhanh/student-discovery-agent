'use client';

import { useParams } from 'next/navigation';
import { KnowledgeDocumentsPage } from '@/features/knowledge';

export default function DocumentsPage() {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeDocumentsPage kb={decodeURIComponent(kb)} />;
}
