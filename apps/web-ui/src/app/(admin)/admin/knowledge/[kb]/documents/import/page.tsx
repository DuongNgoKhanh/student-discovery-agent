'use client';

import { useParams } from 'next/navigation';
import { KnowledgeImportPage } from '@/features/knowledge';

export default function ImportPage() {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeImportPage kb={decodeURIComponent(kb)} />;
}
