'use client';

import Link from 'next/link';
import { ChevronDown, FilePlus, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DocumentsTab } from './documents-tab';
import { kbHref } from './knowledge-base-shell';
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

export function KnowledgeDocumentsPage({ kb }: { kb: string }) {
  return (
    <>
      <PageTitle
        title="Tài liệu"
        description="Mọi tài liệu của knowledge base này."
        actions={<><MetadataSheet kb={kb} /><AddDocumentMenu kb={kb} /></>}
      />
      <DocumentsTab kb={kb} />
    </>
  );
}
