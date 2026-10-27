'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { FieldsTab } from './fields-tab';

export function MetadataSheet({ kb }: { kb: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline"><SlidersHorizontal className="h-4 w-4" aria-hidden />Metadata</Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Metadata</SheetTitle>
          <SheetDescription>Trường dùng để lọc và hiển thị trong thẻ kiến thức của agent.</SheetDescription>
        </SheetHeader>
        <div className="overflow-x-auto"><FieldsTab kb={kb} /></div>
      </SheetContent>
    </Sheet>
  );
}
