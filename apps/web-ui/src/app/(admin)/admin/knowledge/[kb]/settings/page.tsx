'use client';

import { useParams } from 'next/navigation';
import { KnowledgeSettings } from '@/features/knowledge';

export default function SettingsPage() {
  const { kb } = useParams<{ kb: string }>();
  return <KnowledgeSettings kb={decodeURIComponent(kb)} />;
}
