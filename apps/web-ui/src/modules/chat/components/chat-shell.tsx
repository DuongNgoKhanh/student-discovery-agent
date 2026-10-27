'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { DEMO_NOTICE_TEXT, GREETING_TEXT } from '../fixtures';
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
import { ChatHeader } from './chat-header';
import { ChatMessageItem } from './chat-message-item';
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
  const [isStarting, setIsStarting] = useState(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
    };
  }, []);

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
    setIsStarting(false);
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
      appendEntries([{ role: 'user', text: echo }]);
      turns.submit(draft, view.revision, (result: TurnResult) => {
        appendEntries(result.blocks.map((block) => ({ role: 'bot' as const, block })));
      });
    },
    [appendEntries, turns, view],
  );

  const retryTurn = () =>
    turns.retry((result: TurnResult) => {
      appendEntries(result.blocks.map((block) => ({ role: 'bot' as const, block })));
    });

  const busy = turns.isPending || createConversation.isPending;

  const handleStart = useCallback(() => {
    if (isStarting || busy) return;
    setIsStarting(true);
    startTimerRef.current = setTimeout(() => {
      send({ type: 'message', content: { text: 'Bắt đầu' } }, 'Bắt đầu');
      setIsStarting(false);
    }, 150);
  }, [busy, isStarting, send]);
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
  const isInitial = !activity && !entries.some((e) => e.role === 'user');

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

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200/50 bg-[#f8f9fb] shadow-2xl dark:border-white/5 dark:bg-panel">
        <ChatHeader
          title="Trò chuyện hướng nghiệp"
          subtitle="Đang hoạt động"
          isDesktopSidebarOpen={isDesktopSidebarOpen}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onToggleDesktopSidebar={() => setIsDesktopSidebarOpen((prev) => !prev)}
        />

        <div
          id="thread"
          className="no-scrollbar flex flex-1 flex-col space-y-6 overflow-y-auto px-4 py-6 md:px-8 md:py-8 lg:px-10"
        >
          {activity?.is_demo && (
            <div className="mx-auto w-full max-w-2xl md:max-w-3xl animate-in fade-in duration-300">
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {DEMO_NOTICE_TEXT}
              </p>
            </div>
          )}

          {isNotConfigured ? (
            <div className="mx-auto w-full max-w-2xl md:max-w-3xl">
              <NotConfiguredPanel />
            </div>
          ) : isInitialLoadingOrError ? (
            <div className="mx-auto w-full max-w-2xl md:max-w-3xl">
              {initialError ? (
                <ErrorPanel
                  message={initialError.message || mapErrorMessage('SYS_500')}
                  onRetry={retryInitial}
                />
              ) : (
                <LoadingPanel />
              )}
            </div>
          ) : isInitial ? (
            <div
              className={cn(
                'mx-auto flex h-full min-h-[460px] w-full max-w-2xl flex-1 flex-col items-center justify-center py-10 text-center transition-all duration-300 ease-out',
                isStarting && 'scale-95 -translate-y-6 opacity-0 pointer-events-none',
              )}
            >
              <h1 className="mb-8 max-w-lg text-2xl font-medium tracking-tight text-slate-800 dark:text-slate-100 sm:text-3xl animate-in fade-in duration-500">
                {GREETING_TEXT}
              </h1>

              {turns.isPending && (
                <p role="status" className="mb-3 text-xs text-muted-foreground animate-pulse">
                  Đang gửi...
                </p>
              )}
              {turnError && (
                <div className="mb-3 w-full">
                  <ErrorPanel
                    message={turnError.message}
                    onRetry={turnErrorRetryable ? retryTurn : undefined}
                  />
                </div>
              )}

              <div className="flex items-center justify-center">
                <Button
                  disabled={busy || isStarting}
                  onClick={handleStart}
                  className="rounded-full bg-slate-900 px-6 py-2 text-sm font-medium text-white shadow-xs transition-all hover:bg-slate-800 active:scale-95 hover:scale-105 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  Bắt đầu
                </Button>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl md:max-w-3xl animate-in fade-in duration-300">
              <ol aria-label="Hội thoại" className="flex flex-col gap-6">
                {entries.map((entry, index) => {
                  const isConsecutiveBot =
                    entry.role === 'bot' && index > 0 && entries[index - 1]?.role === 'bot';
                  const staggerClass =
                    index === 1
                      ? 'animation-delay-150'
                      : index === 2
                        ? 'animation-delay-300'
                        : undefined;
                  return (
                    <li key={entry.id} className="w-full">
                      <ChatMessageItem
                        role={entry.role}
                        text={entry.text}
                        block={entry.block}
                        showAvatar={!isConsecutiveBot}
                        className={staggerClass}
                      />
                    </li>
                  );
                })}

                {turns.isPending && (
                  <li className="w-full animate-message-pop animation-delay-150" aria-label="Trợ lý đang trả lời">
                    <div className="flex w-full items-start justify-start gap-3">
                      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800">
                        <Image
                          src="/bot-avatar.png"
                          alt="Avatar trợ lý"
                          width={24}
                          height={24}
                          className="h-6 w-6 object-contain"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        <span className="sr-only">Đang gửi...</span>
                      </div>
                    </div>
                  </li>
                )}
              </ol>
            </div>
          )}
        </div>

        {!isInitial && (
          <div className="shrink-0 border-t border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur-md dark:border-white/5 dark:bg-panel/90 md:px-8 lg:px-10 animate-in fade-in slide-in-from-bottom-4 duration-400 ease-out fill-mode-both">
            <div className="mx-auto max-w-2xl md:max-w-3xl">
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
        )}
      </main>
    </div>
  );
}
