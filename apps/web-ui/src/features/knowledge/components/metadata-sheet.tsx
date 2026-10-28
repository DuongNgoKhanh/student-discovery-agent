'use client';

import { useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useFields } from '../hooks/use-knowledge';
import type { MetadataField } from '../types';
import { MetadataFieldForm } from './metadata-field-form';
import { MetadataFieldRow } from './metadata-field-row';
import { EmptyState } from './shared/empty-state';
import { QueryState } from './shared/query-state';

// Stable sort keeps the server order for equal ordinals.
const byOrdinal = (fields: MetadataField[]) => [...fields].sort((a, b) => a.ordinal - b.ordinal);

function MetadataFields({ kb }: { kb: string }) {
  const query = useFields(kb);
  const [adding, setAdding] = useState(false);
  const nextOrdinal = Math.max(-1, ...(query.data ?? []).map(field => field.ordinal)) + 1;
  return (
    <div className="space-y-4">
      <QueryState query={query} isEmpty={fields => fields.length === 0 && !adding}
        empty={<EmptyState title="Chưa có trường nào" description="Thêm trường để lọc tài liệu khi truy xuất." className="py-8" />}>
        {fields => {
          const sorted = byOrdinal(fields);
          return sorted.length > 0 && (
            <div>
              <div className="flex items-center gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                <span className="flex-1 pl-8">Trường</span><span className="w-20">Kiểu</span><span className="w-[4.75rem]">Lọc được</span>
              </div>
              <ul className="divide-y" aria-label="Trường metadata">
                {sorted.map((field, index) => (
                  <MetadataFieldRow key={field.id} kb={kb} field={field} previous={sorted[index - 1]} next={sorted[index + 1]} />
                ))}
              </ul>
            </div>
          );
        }}
      </QueryState>
      {adding ? (
        <MetadataFieldForm kb={kb} ordinal={nextOrdinal} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} disabled={query.isLoading}>
          <Plus className="h-4 w-4" aria-hidden />Thêm trường
        </Button>
      )}
    </div>
  );
}

export function MetadataSheet({ kb }: { kb: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline"><SlidersHorizontal className="h-4 w-4" aria-hidden />Metadata</Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>Metadata</SheetTitle>
          <SheetDescription>Trường dùng để lọc và hiển thị trong thẻ kiến thức của agent.</SheetDescription>
        </SheetHeader>
        <MetadataFields kb={kb} />
      </SheetContent>
    </Sheet>
  );
}
