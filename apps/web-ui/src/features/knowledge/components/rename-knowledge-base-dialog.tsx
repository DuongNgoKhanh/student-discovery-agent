'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useUpdateKnowledgeBase } from '../hooks/use-knowledge';
import type { KnowledgeBase } from '../types';
import { ErrorText } from './error-text';

export interface RenameKnowledgeBaseDialogProps {
  kb: KnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameKnowledgeBaseDialog({ kb, open, onOpenChange }: RenameKnowledgeBaseDialogProps) {
  const update = useUpdateKnowledgeBase();
  const form = useForm<{ name: string }>({ defaultValues: { name: kb.name } });
  const { errors } = form.formState;
  const { reset } = form;
  const resetUpdate = update.reset;
  // Start from the current name every time the dialog opens.
  useEffect(() => { if (open) { reset({ name: kb.name }); resetUpdate(); } }, [open, kb.name, reset, resetUpdate]);

  const submit = form.handleSubmit(({ name }) => {
    const next = name.trim();
    if (next === kb.name) { onOpenChange(false); return; }
    update.mutate({ kb: kb.id, body: { name: next } }, {
      onSuccess: saved => { toast.success(`Đã đổi tên thành "${saved.name}"`); onOpenChange(false); },
    });
  });

  return (
    <Dialog open={open} onOpenChange={next => { if (!update.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi tên knowledge base</DialogTitle>
          <DialogDescription>ID <code className="font-mono">{kb.id}</code> không đổi.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="kb-rename">Tên</Label>
            <Input id="kb-rename" autoFocus aria-invalid={!!errors.name} aria-describedby={errors.name ? 'kb-rename-error' : undefined}
              {...form.register('name', { validate: value => value.trim() !== '' || 'Nhập tên knowledge base.' })} />
            {errors.name && <p id="kb-rename-error" className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <ErrorText error={update.error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={update.isPending} onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={update.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
