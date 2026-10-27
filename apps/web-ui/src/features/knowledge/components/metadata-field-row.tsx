'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SheetClose } from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api/errors';
import { knowledgeKeys, useDeleteField, usePatchField } from '../hooks/use-knowledge';
import type { MetadataField } from '../types';
import { kbHref } from './knowledge-base-shell';
import { FIELD_TYPES } from './metadata-field-form';
import { ConfirmDialog } from './shared/confirm-dialog';
import { errorMessage } from './shared/error-message';

export interface MetadataFieldRowProps {
  kb: string;
  field: MetadataField;
  /** Neighbour to swap ordinals with; missing at the ends of the list. */
  previous?: MetadataField;
  next?: MetadataField;
}

export function MetadataFieldRow({ kb, field, previous, next }: MetadataFieldRowProps) {
  const client = useQueryClient();
  const patch = usePatchField();
  const remove = useDeleteField();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inUse, setInUse] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const title = field.label || field.name;

  const setFilterable = async (filterable: boolean) => {
    const key = knowledgeKeys.fields(kb);
    await client.cancelQueries({ queryKey: key });
    const previousFields = client.getQueryData<MetadataField[]>(key);
    client.setQueryData<MetadataField[]>(key, fields => fields?.map(item => item.id === field.id ? { ...item, filterable } : item));
    try {
      await patch.mutateAsync({ kb, name: field.name, body: { filterable } });
    } catch (error) {
      client.setQueryData(key, previousFields);
      toast.error(errorMessage(error));
    }
  };

  // Equal ordinals (older data) cannot be swapped, so the field moving up takes the lower one and the other is pushed below it.
  const move = async (neighbour: MetadataField, up: boolean) => {
    const [top, bottom] = up ? [field, neighbour] : [neighbour, field];
    const low = Math.min(field.ordinal, neighbour.ordinal);
    const high = field.ordinal === neighbour.ordinal ? low + 1 : Math.max(field.ordinal, neighbour.ordinal);
    setMoving(true);
    try {
      await Promise.all([
        patch.mutateAsync({ kb, name: top.name, body: { ordinal: low } }),
        patch.mutateAsync({ kb, name: bottom.name, body: { ordinal: high } }),
      ]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMoving(false);
    }
  };

  const saveLabel = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await patch.mutateAsync({ kb, name: field.name, body: { label: label.trim() } });
      setEditing(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const deleteField = async () => {
    try {
      await remove.mutateAsync({ kb, name: field.name });
      toast.success(`Đã xoá trường "${title}"`);
    } catch (error) {
      if (error instanceof ApiError && error.httpStatus === 409) {
        const documents = (error.details as { documents?: unknown } | undefined)?.documents;
        setInUse(typeof documents === 'number' ? documents : 0);
      } else {
        toast.error(errorMessage(error));
      }
    }
  };

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 flex-col">
          <Button variant="ghost" size="icon" className="h-5 w-6" aria-label={`Đưa "${title}" lên`} disabled={!previous || moving}
            onClick={() => previous && void move(previous, true)}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-6" aria-label={`Đưa "${title}" xuống`} disabled={!next || moving}
            onClick={() => next && void move(next, false)}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={event => void saveLabel(event)} className="flex items-center gap-1">
              <Input value={label} onChange={event => setLabel(event.target.value)} aria-label={`Label của ${field.name}`}
                autoFocus maxLength={200} className="h-8" />
              <Button type="submit" size="sm" disabled={patch.isPending}>Lưu</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Huỷ</Button>
            </form>
          ) : (
            <p className="truncate text-sm font-medium">{field.label || <span className="text-muted-foreground">(chưa có label)</span>}</p>
          )}
          <p className="truncate font-mono text-xs text-muted-foreground">{field.name}</p>
        </div>
        <span className="w-20 shrink-0 text-13 text-muted-foreground">{FIELD_TYPES[field.type].label}</span>
        <Switch checked={field.filterable} onCheckedChange={value => void setFilterable(value)}
          aria-label={`Lọc được theo ${title}`} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Thao tác cho trường ${title}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => { setLabel(field.label); setEditing(true); }}><Pencil aria-hidden />Sửa label</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setInUse(null); setConfirmDelete(true); }}>
              <Trash2 aria-hidden />Xoá
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {inUse !== null && (
        <p role="alert" className="mt-1 pl-8 text-xs text-destructive">
          {inUse > 0 ? `Còn ${inUse} tài liệu đang dùng trường này.` : 'Còn tài liệu đang dùng trường này.'}{' '}
          <SheetClose asChild><Link href={kbHref(kb, 'documents')} className="underline">Xem tài liệu</Link></SheetClose>
        </p>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Xoá trường "${title}"?`}
        description="Chỉ xoá được khi không còn tài liệu đang bật nào dùng trường này." confirmLabel="Xoá" destructive onConfirm={deleteField} />
    </li>
  );
}
