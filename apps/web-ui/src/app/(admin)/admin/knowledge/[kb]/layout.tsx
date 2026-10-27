'use client';

import { useParams } from 'next/navigation';
import { KnowledgeBaseShell } from '@/features/knowledge';

export default function KnowledgeBaseLayout({ children }: { children: React.ReactNode }) {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeBaseShell kb={decodeURIComponent(kb)}>{children}</KnowledgeBaseShell>;
}
