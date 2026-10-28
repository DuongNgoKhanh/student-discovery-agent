'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { ChevronDown, FilePlus, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDocumentFilters } from '../hooks/use-document-filters';
import { DocumentDetailSheet } from './document-detail-sheet';
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
  const { q, state, doc, filters, isFiltered, setQ, setState, setDoc, clear } = useDocumentFilters();
  // One sheet for the whole table. The id stays after closing so the content doesn't vanish mid-animation.
  const [sheet, setSheet] = useState<{ docId: string | null; open: boolean; focus?: 'error' }>(() => ({ docId: doc, open: doc !== null }));
  const openDocument = (docId: string, focus?: 'error') => { setSheet({ docId, open: true, focus }); setDoc(docId); };
  const onSheetOpenChange = (open: boolean) => {
    setSheet(current => ({ ...current, open }));
    if (!open) setDoc(null);
  };
  return (
    <>
      <DocumentsToolbar q={q} state={state} onQChange={setQ} onStateChange={setState}
        actions={<><MetadataSheet kb={kb} /><AddDocumentMenu kb={kb} /></>} />
      <DocumentsTable key={JSON.stringify(filters)} kb={kb} filters={filters} isFiltered={isFiltered} onClearFilters={clear}
        onOpenDocument={openDocument} />
      <DocumentDetailSheet kb={kb} docId={sheet.docId} open={sheet.open} onOpenChange={onSheetOpenChange} focus={sheet.focus} />
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
