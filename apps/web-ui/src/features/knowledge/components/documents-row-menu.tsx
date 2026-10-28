'use client';

import Link from 'next/link';
import { CircleAlert, Copy, Eye, MoreHorizontal, PencilLine, RotateCw } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import type { DocumentSummary } from '../types';
import { kbHref } from './kb-routes';
import { copyText } from './shared/copy-button';

export interface DocumentRowMenuProps {
  kb: string;
  doc: DocumentSummary;
  onOpen: (focus?: 'error') => void;
  onRetry: () => void;
  retrying: boolean;
}

/** Row actions: the detail sheet, the error (when indexing failed), the editor and the ID. */
export function DocumentRowMenu({ kb, doc, onOpen, onRetry, retrying }: DocumentRowMenuProps) {
  const failed = doc.index_status === 'error';
  const copyId = async () => {
    if (await copyText(doc.id)) toast.success('Đã copy ID'); else toast.error('Không copy được ID.');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton className="h-8 w-8" label={`Thao tác cho ${doc.title}`} tooltip="Thao tác">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen()}><Eye aria-hidden />Xem chi tiết</DropdownMenuItem>
        {failed && <DropdownMenuItem onSelect={() => onOpen('error')}><CircleAlert aria-hidden />Xem lỗi</DropdownMenuItem>}
        {failed && <DropdownMenuItem disabled={retrying} onSelect={onRetry}><RotateCw aria-hidden />Thử index lại</DropdownMenuItem>}
        <DropdownMenuItem asChild>
          <Link href={kbHref(kb, `documents/${encodeURIComponent(doc.id)}`)}><PencilLine aria-hidden />Chỉnh sửa</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copyId()}><Copy aria-hidden />Copy ID</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
