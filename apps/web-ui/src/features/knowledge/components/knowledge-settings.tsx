'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { useKnowledgeBase, useUpdateKnowledgeBase } from '../hooks/use-knowledge';
import type { KnowledgeBase, KnowledgeBasePatch } from '../types';
import { AgentTab } from './agent-tab';
import { ErrorText } from './error-text';
import { CopyButton } from './shared/copy-button';
import { PageTitle } from './shared/page-title';
import { QueryState } from './shared/query-state';

type SettingsForm = { name: string; description: string };

const ROW = 'grid gap-1.5 py-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6';

function SettingsForm({ kb }: { kb: KnowledgeBase }) {
  const update = useUpdateKnowledgeBase();
  const form = useForm<SettingsForm>({
    values: { name: kb.name, description: kb.description },
    resetOptions: { keepDirtyValues: true },
  });
  const { errors, isDirty, dirtyFields } = form.formState;

  const submit = form.handleSubmit(values => {
    const body: KnowledgeBasePatch = {
      ...(dirtyFields.name ? { name: values.name.trim() } : {}),
      ...(dirtyFields.description ? { description: values.description } : {}),
    };
    update.mutate({ kb: kb.id, body }, {
      onSuccess: saved => { form.reset({ name: saved.name, description: saved.description }); toast.success('Đã lưu cài đặt'); },
    });
  });

  return (
    <form onSubmit={submit} className="divide-y border-t" noValidate>
      <div className={ROW}>
        <Label htmlFor="kb-settings-name" className="md:pt-2.5">Tên</Label>
        <div className="space-y-1">
          <Input id="kb-settings-name" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'kb-settings-name-error' : undefined}
            {...form.register('name', { validate: value => value.trim() !== '' || 'Nhập tên knowledge base.' })} />
          {errors.name && <p id="kb-settings-name-error" className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
      </div>
      <div className={ROW}>
        <Label htmlFor="kb-settings-description" className="md:pt-2.5">Mô tả</Label>
        <Textarea id="kb-settings-description" rows={3} maxLength={2000} className="font-sans" {...form.register('description')} />
      </div>
      <div className={ROW}>
        <span className="text-sm font-medium md:pt-2">ID</span>
        <div className="flex items-center gap-2">
          <code className="font-mono text-13">{kb.id}</code>
          <CopyButton value={kb.id} iconOnly variant="ghost" label="Copy ID" className="h-8 w-8" />
        </div>
      </div>
      <div className={ROW}>
        <span className="text-sm font-medium">Embedding model</span>
        <div>
          <p className="font-mono text-13">{kb.embedding_model}</p>
          <p className="text-xs text-muted-foreground">Không đổi được sau khi tạo.</p>
        </div>
      </div>
      <div className={ROW}>
        <span aria-hidden />
        <div className="space-y-2">
          <ErrorText error={update.error} />
          <Button type="submit" disabled={!isDirty || update.isPending}>Lưu</Button>
        </div>
      </div>
    </form>
  );
}

export function KnowledgeSettings({ kb }: { kb: string }) {
  const base = useKnowledgeBase(kb);
  return (
    <div className="max-w-3xl">
      <PageTitle title="Cài đặt" description="Thông tin của knowledge base và cách gắn vào agent." />
      <section aria-labelledby="kb-info-heading">
        <h2 id="kb-info-heading" className="mb-3 text-base font-semibold">Thông tin chung</h2>
        <QueryState query={base}>{data => <SettingsForm kb={data} />}</QueryState>
      </section>
      <section aria-labelledby="kb-agent-heading" className="mt-10">
        <h2 id="kb-agent-heading" className="text-base font-semibold">Dùng cho agent</h2>
        <p className="mb-4 text-13 text-muted-foreground">Agent đọc knowledge base này qua hai tool trong cấu hình release.</p>
        <div className="border-t pt-4"><AgentTab kb={kb} /></div>
      </section>
    </div>
  );
}
