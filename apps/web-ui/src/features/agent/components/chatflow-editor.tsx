'use client';

import { ArrowLeft } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Near full-window frame for editing the chatflow graph: it covers the page instead of being a separate route, so
 * unsaved edits and the draft actions (save, validate, publish) stay with the Agent page that owns them.
 */
export function ChatflowEditor({ tabs, actions, notices, onClose, closeDisabled, children }: {
  tabs: ReactNode;
  actions?: ReactNode;
  /** Issues and load errors, shown between the header and the canvas. */
  notices?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  // The page behind must not scroll under the editor.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Trình chỉnh sửa Chatflow" className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          title={closeDisabled ? 'Sửa lỗi JSON trước khi đóng' : undefined}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-13 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <ArrowLeft className="size-4" /> Về trang Agent
        </button>
        <span aria-hidden className="h-5 w-px bg-border" />
        <h2 className="text-sm font-semibold">Chatflow</h2>
        {tabs}
        <div className="ml-auto">{actions}</div>
      </header>
      {notices ? <div className="max-h-48 shrink-0 space-y-2 overflow-y-auto border-b px-4 py-2">{notices}</div> : null}
      <div className="relative min-h-0 flex-1 p-3">{children}</div>
    </div>,
    document.body,
  );
}
