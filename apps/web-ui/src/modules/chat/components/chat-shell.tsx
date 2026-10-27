'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';
import { queryKeys } from '@/lib/query/keys';
import { DEMO_NOTICE_TEXT } from '../fixtures';
import {
  newIdempotencyKey,
  useConversation,
  useCreateConversation,
  useSendTurn,
  type TurnDraft,
} from '../hooks/use-chat';
import type { RenderableBlock } from '../schemas/blocks';
import type { CreatedConversation, TurnResult } from '../schemas/conversation';
import { ActivityControls, type SendFn } from './activity-controls';
import { BlockRenderer } from './block-renderer';
import { ChatHeader } from './chat-header';
import { ChatSidebar, type ChatThreadItem } from './chat-sidebar';
import { ErrorPanel, LoadingPanel, NotConfiguredPanel } from './status-panels';

interface Entry {
  id: number;
  role: 'bot' | 'user';
  text?: string;
  block?: RenderableBlock;
}

const NOT_CONFIGURED_CODES = new Set(['EXPERIENCE_NOT_CONFIGURED', 'ACTIVE_RELEASE_CONFLICT']);

/** Màn hình chat của học sinh (M-UI) theo cấu trúc LKP ChatPage. */
export function ChatShell() {
  const queryClient = useQueryClient();
  const createConversation = useCreateConversation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextEntryId = useRef(0);
  const createKey = useRef<string | null>(null);
  const pendingEcho = useRef('');
  const started = useRef(false);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [threads, setThreads] = useState<ChatThreadItem[]>([]);

  const conversation = useConversation(conversationId);
  const turns = useSendTurn(conversationId ?? '');
  const view = conversation.data ?? null;
  const activity = view?.active_activity ?? null;

  const appendEntries = useCallback((items: Omit<Entry, 'id'>[]) => {
    setEntries((prev) => [
      ...prev,
      ...items.map((item) => ({ ...item, id: nextEntryId.current++ })),
    ]);
  }, []);

  const handleCreated = useCallback(
    (created: CreatedConversation) => {
      queryClient.setQueryData(
        queryKeys.chat.conversation(created.conversation.id),
        created.conversation,
      );
      setConversationId(created.conversation.id);
      setEntries([]);
      appendEntries(created.blocks.map((block) => ({ role: 'bot' as const, block })));

      setThreads((prev) => {
        if (prev.some((t) => t.id === created.conversation.id)) return prev;
        return [
          {
            id: created.conversation.id,
            title: 'Trò chuyện hướng nghiệp',
            time: 'Vừa xong',
          },
          ...prev,
        ];
      });
    },
    [appendEntries, queryClient],
  );

  /** Bắt đầu phiên mới với key mới. Retry lỗi tạo phiên dùng lại key cũ. */
  const startSession = useCallback(() => {
    createKey.current = newIdempotencyKey('create');
    createConversation.mutate(createKey.current, { onSuccess: handleCreated });
  }, [createConversation, handleCreated]);

  const retryCreate = useCallback(() => {
    if (!createKey.current) return startSession();
    createConversation.mutate(createKey.current, { onSuccess: handleCreated });
  }, [createConversation, handleCreated, startSession]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startSession();
  }, [startSession]);

  useEffect(() => {
    const thread = document.getElementById('thread');
    if (thread) {
      if (typeof thread.scrollTo === 'function') {
        thread.scrollTo({
          top: thread.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        thread.scrollTop = thread.scrollHeight;
      }
    }
  }, [entries, turns.isPending]);

  const send: SendFn = useCallback(
    (draft: TurnDraft, echo: string) => {
      if (!view) return;
      pendingEcho.current = echo;
      turns.submit(draft, view.revision, (result: TurnResult) => {
        appendEntries([
          { role: 'user', text: pendingEcho.current },
          ...result.blocks.map((block) => ({ role: 'bot' as const, block })),
        ]);
      });
    },
    [appendEntries, turns, view],
  );

  const retryTurn = () =>
    turns.retry((result: TurnResult) => {
      appendEntries([
        { role: 'user', text: pendingEcho.current },
        ...result.blocks.map((block) => ({ role: 'bot' as const, block })),
      ]);
    });

  const busy = turns.isPending || createConversation.isPending;
  const turnError = turns.error instanceof ApiError ? turns.error : null;
  const turnErrorRetryable = turnError?.retryable ?? false;

  const isNotConfigured =
    createConversation.error instanceof ApiError &&
    NOT_CONFIGURED_CODES.has(createConversation.error.code);

  const isInitialLoadingOrError = !view && !isNotConfigured;
  const initialError =
    isInitialLoadingOrError && (createConversation.error || conversation.error)
      ? ((createConversation.error ?? conversation.error) as Error)
      : null;

  const retryInitial = createConversation.error ? retryCreate : () => void conversation.refetch();

  return (
    <div className="relative flex h-screen w-full gap-3 overflow-hidden bg-gray-bg p-3 font-sans text-slate-800 antialiased transition-colors duration-300 selection:bg-emerald-500/20 selection:text-white dark:bg-ink dark:text-gray-100 md:gap-4 md:p-4">
      <ChatSidebar
        threads={threads}
        activeThreadId={conversationId ?? 'new'}
        isMobileSidebarOpen={isMobileSidebarOpen}
        isDesktopSidebarOpen={isDesktopSidebarOpen}
        userName="Học sinh"
        onNewChat={() => {
          startSession();
          setIsMobileSidebarOpen(false);
        }}
        onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
        onToggleDesktopSidebar={() => setIsDesktopSidebarOpen((prev) => !prev)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200/50 bg-white shadow-2xl dark:border-white/5 dark:bg-panel">
        <ChatHeader
          title="Trò chuyện hướng nghiệp"
          subtitle="Đang hoạt động"
          isDesktopSidebarOpen={isDesktopSidebarOpen}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onToggleDesktopSidebar={() => setIsDesktopSidebarOpen((prev) => !prev)}
        />

        <div
          id="thread"
          className="no-scrollbar flex-1 space-y-6 overflow-y-auto px-4 py-6 md:px-8 md:py-8 lg:px-10"
        >
          {activity?.is_demo && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {DEMO_NOTICE_TEXT}
            </p>
          )}

          {isNotConfigured ? (
            <NotConfiguredPanel />
          ) : isInitialLoadingOrError ? (
            initialError ? (
              <ErrorPanel
                message={initialError.message || mapErrorMessage('SYS_500')}
                onRetry={retryInitial}
              />
            ) : (
              <LoadingPanel />
            )
          ) : (
            <ol aria-label="Hội thoại" className="flex flex-col gap-4">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={entry.role === 'user' ? 'max-w-[85%] self-end' : 'max-w-full'}
                >
                  {entry.role === 'user' ? (
                    <div className="shadow-xs break-words rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm text-white dark:bg-emerald-500">
                      {entry.text}
                    </div>
                  ) : entry.block ? (
                    <BlockRenderer block={entry.block} />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur-md dark:border-white/5 dark:bg-panel/90 md:px-8 lg:px-10">
          <div className="mx-auto max-w-2xl">
            {turns.isPending && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                Đang gửi...
              </p>
            )}
            {turnError && (
              <div className="mb-2">
                <ErrorPanel
                  message={turnError.message}
                  onRetry={turnErrorRetryable ? retryTurn : undefined}
                />
              </div>
            )}
            {view && (
              <ActivityControls
                conversation={view}
                activity={activity}
                disabled={busy}
                send={send}
                onNewSession={startSession}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
