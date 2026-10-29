'use client';

import { useState } from 'react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  /** A returned promise keeps the dialog open (button disabled) until it settles; a rejection keeps it open. */
  onConfirm: () => unknown;
  /** Uncontrolled use: the element that opens the dialog. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** AlertDialog focuses Cancel first, so Enter never confirms by accident. */
export function ConfirmDialog({
  title, description, confirmLabel = 'Xác nhận', cancelLabel = 'Huỷ', destructive, confirmDisabled, onConfirm, trigger, open, onOpenChange,
}: ConfirmDialogProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (next: boolean) => { if (open === undefined) setInnerOpen(next); onOpenChange?.(next); };
  const confirm = async () => {
    setPending(true);
    try { await onConfirm(); setOpen(false); } catch { /* caller renders the error; keep the dialog open */ } finally { setPending(false); }
  };
  return (
    <AlertDialog open={isOpen} onOpenChange={next => { if (!pending) setOpen(next); }}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={pending || confirmDisabled} onClick={() => void confirm()}>{confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
