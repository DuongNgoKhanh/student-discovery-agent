import { redirect } from 'next/navigation';

export default async function KnowledgeBasePage({ params }: { params: Promise<{ kb: string }> }) {
  const { kb } = await params;
  redirect(`/admin/knowledge/${kb}/documents`);
}
