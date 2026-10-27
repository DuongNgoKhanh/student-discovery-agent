'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Warns before losing unsaved edits: the browser prompt on reload/close, and a confirm step for any internal link
 * clicked anywhere on the page (sidebar and app nav included). Router calls made by code are not intercepted.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    // Document capture runs before React's root listeners, so next/link sees the prevented default and skips navigation.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link || (link.getAttribute('target') ?? '_self') !== '_self' || link.hasAttribute('download')) return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      setPendingHref(href);
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return {
    open: pendingHref !== null,
    onOpenChange: (open: boolean) => { if (!open) setPendingHref(null); },
    onConfirm: () => { if (pendingHref) router.push(pendingHref); },
  };
}
