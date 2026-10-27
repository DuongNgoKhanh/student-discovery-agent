'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Clipboard API first, then the legacy execCommand path (http origins, older browsers). */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard) {
    try { await clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
}

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'value' | 'children'> {
  value: string | (() => string);
  /** Visible text; with `iconOnly` it becomes the aria-label. */
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
}

export function CopyButton({
  value, label = 'Copy', copiedLabel = 'Đã copy', iconOnly, variant = 'outline', size, ...props
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(typeof value === 'function' ? value() : value);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setState('idle'), 2000);
  };
  const text = state === 'copied' ? copiedLabel : label;
  const Icon = state === 'copied' ? Check : Copy;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button" variant={variant} size={iconOnly ? 'icon' : size}
        aria-label={iconOnly ? text : undefined} title={iconOnly ? text : undefined}
        onClick={() => void copy()} {...props}
      >
        <Icon className="h-4 w-4" aria-hidden />{!iconOnly && text}
      </Button>
      {state === 'failed' && <span role="alert" className="text-xs text-destructive">Không copy được, hãy chọn và copy thủ công.</span>}
    </span>
  );
}
