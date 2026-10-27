'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { useKnowledgeBase } from '../hooks/use-knowledge';
import { AgentTab } from './agent-tab';
import { DocumentsTab } from './documents-tab';
import { ErrorText } from './error-text';
import { FieldsTab } from './fields-tab';
import { ImportTab } from './import-tab';
import { SearchTab } from './search-tab';

const TABS = [
  ['documents', 'Documents'], ['fields', 'Fields'], ['import', 'Import'], ['search', 'Thử tìm kiếm'], ['agent', 'Dùng cho agent'],
] as const;
type Tab = (typeof TABS)[number][0];

export function KnowledgeBaseDetail({ kb }: { kb: string }) {
  const base = useKnowledgeBase(kb);
  const [tab, setTab] = useState<Tab>('documents');
  return (
    <>
      <PageHeader title={base.data?.name ?? kb} />
      <ErrorText error={base.error} />
      {base.data && <p className="mb-4 text-sm text-gray-600">ID {base.data.id} · model {base.data.embedding_model}</p>}
      <div role="tablist" className="mb-4 flex gap-4 border-b text-sm">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={tab === id ? 'border-b-2 border-black pb-2 font-semibold' : 'pb-2'}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'documents' && <DocumentsTab kb={kb} />}
      {tab === 'fields' && <FieldsTab kb={kb} />}
      {tab === 'import' && <ImportTab kb={kb} />}
      {tab === 'search' && <SearchTab kb={kb} />}
      {tab === 'agent' && <AgentTab kb={kb} />}
    </>
  );
}
