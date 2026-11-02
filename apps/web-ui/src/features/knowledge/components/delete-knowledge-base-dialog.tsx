'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api/errors';
import { useDeleteKnowledgeBase } from '../hooks/use-knowledge';
import type { KnowledgeBase } from '../types';
import { ErrorText } from './error-text';

export interface DeleteKnowledgeBaseDialogProps {
  kb: KnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteKnowledgeBaseDialog({ kb, open, onOpenChange }: DeleteKnowledgeBaseDialogProps) {
  const router = useRouter();
  const remove = useDeleteKnowledgeBase();
  const [typed, setTyped] = useState('');
  const resetRemove = remove.reset;
  useEffect(() => { if (open) { setTyped(''); resetRemove(); } }, [open, resetRemove]);

  const inUse = remove.error instanceof ApiError && remove.error.httpStatus === 409;
  const confirm = () => remove.mutate(kb.id, {
    onSuccess: () => {
      onOpenChange(false);
      toast.success(`Đã xoá knowledge base "${kb.name}"`);
      router.push('/admin/knowledge');
    },
  });

  return (
    <Dialog open={open} onOpenChange={next => { if (!remove.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá knowledge base</DialogTitle>
          <DialogDescription>
            Xoá vĩnh viễn <strong>{kb.name}</strong> cùng {kb.document_count} tài liệu và các bản chỉnh sửa của chúng. Không hoàn tác được.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (typed === kb.name) confirm(); }} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="kb-delete-name">Gõ chính xác tên “{kb.name}” để xác nhận</Label>
            <Input id="kb-delete-name" autoFocus autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} />
          </div>
          {inUse
            ? (
              <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <p>Knowledge base đang được agent dùng</p>
                <Link href="/admin/agent?section=tools" className="underline">Mở trang Agent</Link>
              </div>
            )
            : <ErrorText error={remove.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" variant="destructive" disabled={typed !== kb.name || remove.isPending}>Xoá knowledge base</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
