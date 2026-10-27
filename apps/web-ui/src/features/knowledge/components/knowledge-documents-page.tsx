'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { ChevronDown, FilePlus, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDocumentFilters } from '../hooks/use-document-filters';
import { DocumentsTable } from './documents-table';
import { DocumentsToolbar } from './documents-toolbar';
import { kbHref } from './kb-routes';
import { MetadataSheet } from './metadata-sheet';
import { PageTitle } from './shared/page-title';

export function AddDocumentMenu({ kb }: { kb: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button><Plus className="h-4 w-4" aria-hidden />Thêm tài liệu<ChevronDown className="h-4 w-4" aria-hidden /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href={kbHref(kb, 'documents/new')}><FilePlus aria-hidden />Soạn mới</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={kbHref(kb, 'documents/import')}><Upload aria-hidden />Nhập file</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocumentsView({ kb }: { kb: string }) {
  const { q, state, filters, isFiltered, setQ, setState, clear } = useDocumentFilters();
  return (
    <>
      <DocumentsToolbar q={q} state={state} onQChange={setQ} onStateChange={setState}
        actions={<><MetadataSheet kb={kb} /><AddDocumentMenu kb={kb} /></>} />
      <DocumentsTable key={JSON.stringify(filters)} kb={kb} filters={filters} isFiltered={isFiltered} onClearFilters={clear} />
    </>
  );
}

export function KnowledgeDocumentsPage({ kb }: { kb: string }) {
  return (
    <>
      <PageTitle title="Tài liệu" description="Mọi tài liệu của knowledge base này." />
      {/* useSearchParams needs a Suspense boundary when an ancestor renders statically. */}
      <Suspense><DocumentsView kb={kb} /></Suspense>
    </>
  );
}
