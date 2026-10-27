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
import { ErrorPanel, LoadingPanel, NotConfiguredPanel } from './status-panels';

interface Entry {
  id: number;
  role: 'bot' | 'user';
  text?: string;
  block?: RenderableBlock;
}

const NOT_CONFIGURED_CODES = new Set(['EXPERIENCE_NOT_CONFIGURED', 'ACTIVE_RELEASE_CONFLICT']);

/** Màn hình chat của học sinh (M-UI). Phiên được khôi phục từ server, không tự tạo phiên khi tải lại. */
export function ChatShell() {
  const queryClient = useQueryClient();
  const createConversation = useCreateConversation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextEntryId = useRef(0);
  const createKey = useRef<string | null>(null);
  const pendingEcho = useRef('');
  const started = useRef(false);

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

  if (
    createConversation.error instanceof ApiError &&
    NOT_CONFIGURED_CODES.has(createConversation.error.code)
  ) {
    return (
      <Shell>
        <NotConfiguredPanel />
      </Shell>
    );
  }

  if (!view) {
    if (createConversation.error || conversation.error) {
      const error = (createConversation.error ?? conversation.error) as Error;
      const retry = createConversation.error ? retryCreate : () => void conversation.refetch();
      return (
        <Shell>
          <ErrorPanel message={error.message || mapErrorMessage('SYS_500')} onRetry={retry} />
        </Shell>
      );
    }
    return (
      <Shell>
        <LoadingPanel />
      </Shell>
    );
  }

  const turnError = turns.error instanceof ApiError ? turns.error : null;
  const turnErrorRetryable = turnError?.retryable ?? false;

  return (
    <Shell>
      {activity?.is_demo && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {DEMO_NOTICE_TEXT}
        </p>
      )}

      <ol aria-label="Hội thoại" className="flex flex-1 flex-col gap-3 overflow-y-auto py-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.role === 'user' ? 'max-w-[85%] self-end' : 'max-w-full'}
          >
            {entry.role === 'user' ? (
              <p className="break-words rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
                {entry.text}
              </p>
            ) : entry.block ? (
              <BlockRenderer block={entry.block} />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 border-t pt-3">
        {turns.isPending && (
          <p role="status" className="text-xs text-muted-foreground">
            Đang gửi...
          </p>
        )}
        {turnError && (
          <ErrorPanel
            message={turnError.message}
            onRetry={turnErrorRetryable ? retryTurn : undefined}
          />
        )}
        <ActivityControls
          conversation={view}
          activity={activity}
          disabled={busy}
          send={send}
          onNewSession={startSession}
        />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 px-4 py-4">
      <h1 className="text-lg font-semibold">Trò chuyện hướng nghiệp</h1>
      {children}
    </main>
  );
}
