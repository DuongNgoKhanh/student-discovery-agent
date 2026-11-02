'use client';

import { useParams } from 'next/navigation';
import { KnowledgeTestingPage } from '@/features/knowledge';

export default function TestingPage() {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeTestingPage kb={decodeURIComponent(kb)} />;
}
