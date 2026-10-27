'use client';

import { useParams } from 'next/navigation';
import { KnowledgeBaseDetail } from '@/features/knowledge';

export default function KnowledgeBasePage() {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeBaseDetail kb={kb} />;
}
