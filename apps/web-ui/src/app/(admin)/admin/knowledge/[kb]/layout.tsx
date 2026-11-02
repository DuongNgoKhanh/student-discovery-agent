'use client';

import { useParams } from 'next/navigation';
import { KnowledgeBaseBreadcrumb } from '@/features/knowledge';

export default function KnowledgeBaseLayout({ children }: { children: React.ReactNode }) {
  const { kb } = useParams<{ kb: string }>();
  return (
    <>
      <KnowledgeBaseBreadcrumb kb={decodeURIComponent(kb)} />
      {children}
    </>
  );
}
