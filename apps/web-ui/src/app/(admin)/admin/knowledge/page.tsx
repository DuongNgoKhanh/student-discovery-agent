import { PageHeader } from '@/components/shared/page-header';
import { KnowledgeBaseList } from '@/features/knowledge';

export default function KnowledgeBasesPage() {
  return (
    <>
      <PageHeader title="Knowledge base" />
      <KnowledgeBaseList />
    </>
  );
}
