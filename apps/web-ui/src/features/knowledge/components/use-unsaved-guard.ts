'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Warns before losing unsaved edits: the browser prompt on reload/close, and a confirm step for internal links
 * clicked inside the guarded element (attach `onClickCapture`). Router calls made by code are not intercepted.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Capture phase runs before next/link's onClick, which skips navigation once the default is prevented.
  const onClickCapture = (event: React.MouseEvent) => {
    if (!dirty || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.('a[href]');
    if (!link || (link.getAttribute('target') ?? '_self') !== '_self' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    setPendingHref(href);
  };

  return {
    onClickCapture,
    confirm: {
      open: pendingHref !== null,
      onOpenChange: (open: boolean) => { if (!open) setPendingHref(null); },
      onConfirm: () => { if (pendingHref) router.push(pendingHref); },
    },
  };
}
