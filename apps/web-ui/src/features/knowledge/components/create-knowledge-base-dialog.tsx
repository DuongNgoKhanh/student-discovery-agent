'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import { useCreateKnowledgeBase } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';
import { slugify } from './shared/format';

export const EMBEDDING_MODELS = [
  { value: 'gemini-embedding-2', label: 'gemini-embedding-2' },
  { value: 'multilingual-e5-large', label: 'multilingual-e5-large (vLLM, đa ngôn ngữ)' },
  { value: 'nomic-embed-text-v1.5', label: 'nomic-embed-text-v1.5 (vLLM)' },
  { value: 'fake-embedding', label: 'fake-embedding (chỉ dùng local, không cần key)' },
] as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type CreateForm = { name: string; description: string; embedding_model: string; id: string };

export interface CreateKnowledgeBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateKnowledgeBaseDialog({ open, onOpenChange }: CreateKnowledgeBaseDialogProps) {
  const router = useRouter();
  const create = useCreateKnowledgeBase();
  const [showMore, setShowMore] = useState(false);
  const form = useForm<CreateForm>({ defaultValues: { name: '', description: '', embedding_model: 'gemini-embedding-2', id: '' } });
  const { errors } = form.formState;
  const suggestedId = slugify(form.watch('name'));

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) { form.reset(); create.reset(); setShowMore(false); }
  };
  const submit = form.handleSubmit(values => {
    const id = values.id.trim();
    create.mutate(
      { name: values.name.trim(), embedding_model: values.embedding_model, ...(values.description.trim() ? { description: values.description.trim() } : {}), ...(id ? { id } : {}) },
      { onSuccess: kb => { toast.success(`Đã tạo "${kb.name}"`); close(false); router.push(`/admin/knowledge/${encodeURIComponent(kb.id)}/documents`); } },
    );
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo knowledge base</DialogTitle>
          <DialogDescription>Nơi chứa tài liệu để agent tra cứu.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="kb-name">Tên</Label>
            <Input id="kb-name" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'kb-name-error' : undefined}
              {...form.register('name', { validate: value => value.trim() !== '' || 'Nhập tên knowledge base.' })} />
            {errors.name && <p id="kb-name-error" className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-description">Mô tả</Label>
            <Textarea id="kb-description" rows={2} className="font-sans" placeholder="Không bắt buộc" {...form.register('description')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-model">Embedding model</Label>
            <Controller control={form.control} name="embedding_model" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="kb-model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMBEDDING_MODELS.map(model => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <p className="text-xs text-muted-foreground">Không đổi được sau khi tạo.</p>
          </div>
          <div>
            <button type="button" aria-expanded={showMore} onClick={() => setShowMore(value => !value)}
              className="inline-flex items-center gap-1 rounded-sm text-13 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className={cn('h-4 w-4 transition-transform', showMore && 'rotate-90')} aria-hidden />Tuỳ chọn khác
            </button>
            {showMore && (
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="kb-id">ID</Label>
                <Input id="kb-id" className="font-mono" placeholder={suggestedId || 'tu-dong-theo-ten'}
                  aria-invalid={!!errors.id} aria-describedby="kb-id-hint"
                  {...form.register('id', { validate: value => !value.trim() || ID_PATTERN.test(value.trim()) || 'Chỉ dùng a-z, 0-9, "-" và "_", tối đa 64 ký tự.' })} />
                <p id="kb-id-hint" className={cn('text-xs', errors.id ? 'text-destructive' : 'text-muted-foreground')}>
                  {errors.id?.message ?? 'Để trống thì tự lấy theo tên. Không đổi được sau khi tạo.'}
                </p>
              </div>
            )}
          </div>
          <ErrorText error={create.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending}>Tạo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
