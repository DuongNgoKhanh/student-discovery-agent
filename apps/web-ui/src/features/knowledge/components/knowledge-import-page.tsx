'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ImportTab } from './import-tab';
import { kbHref } from './knowledge-base-shell';
import { PageTitle } from './shared/page-title';

export function KnowledgeImportPage({ kb }: { kb: string }) {
  return (
    <>
      <Link href={kbHref(kb, 'documents')} className="mb-2 inline-flex items-center gap-1 text-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />Tài liệu
      </Link>
      <PageTitle title="Nhập file" description="Nhập nhiều file Markdown/TXT hoặc một file CSV." />
      <ImportTab kb={kb} />
    </>
  );
}
