'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query/keys';
import { getChatApi, type ChatTurnInput } from '../api';
import {
  conversationViewSchema,
  type ConversationView,
  type TurnResult,
} from '../schemas/conversation';

/** Mã tạo khóa idempotency: đủ ngẫu nhiên cho một thao tác, khớp pattern của contract. */
export function newIdempotencyKey(prefix: string): string {
  // randomUUID chỉ có trong ngữ cảnh an toàn (HTTPS/localhost); dự phòng cho truy cập qua HTTP.
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function useConversation(conversationId: string | null) {
  const api = getChatApi();
  return useQuery({
    queryKey: queryKeys.chat.conversation(conversationId ?? ''),
    queryFn: () => api.readConversation(conversationId!),
    enabled: conversationId !== null,
  });
}

export function useCreateConversation() {
  const api = getChatApi();
  return useMutation({
    mutationFn: (idempotencyKey: string) => api.createConversation(idempotencyKey),
  });
}

/** Lượt gửi chưa có key và revision; hook gắn chúng khi gửi. */
export type TurnDraft = ChatTurnInput extends infer T
  ? T extends unknown
    ? Omit<T, 'expected_revision' | 'idempotency_key'>
    : never
  : never;

/**
 * Gửi một lượt. Retry dùng lại đúng key và payload đã gửi lần đầu (QT-04).
 * Khi revision conflict: đồng bộ state từ `details.conversation` và bỏ lượt cũ (QT-03, FR-UI-02).
 */
export function useSendTurn(conversationId: string) {
  const api = getChatApi();
  const queryClient = useQueryClient();
  const pending = useRef<ChatTurnInput | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.sendTurn(conversationId, pending.current!),
    onSuccess: (result) => {
      pending.current = null;
      // Cập nhật ngay từ kết quả commit để thao tác kế tiếp dùng revision mới, không chờ refetch.
      queryClient.setQueryData<ConversationView | undefined>(
        queryKeys.chat.conversation(conversationId),
        (prev) =>
          prev && {
            ...prev,
            revision: result.revision,
            active_activity: result.activity ?? prev.active_activity,
          },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.conversation(conversationId) });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'REVISION_CONFLICT') {
        pending.current = null;
        const parsed = conversationViewSchema.safeParse(
          (error.details as { conversation?: unknown } | undefined)?.conversation,
        );
        if (parsed.success) {
          queryClient.setQueryData(queryKeys.chat.conversation(conversationId), parsed.data);
        } else {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.chat.conversation(conversationId),
          });
        }
        return;
      }
      if (error.code === 'CONVERSATION_ENDED' || error.code === 'CONVERSATION_EXPIRED') {
        pending.current = null;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.chat.conversation(conversationId),
        });
        return;
      }
      if (!error.retryable) pending.current = null;
    },
  });

  // Lỗi và payload chờ retry thuộc về hội thoại cũ; đổi hội thoại thì bỏ đi.
  const { reset } = mutation;
  useEffect(() => {
    pending.current = null;
    reset();
  }, [conversationId, reset]);

  /** Gọi `onDiscard` khi lượt lỗi bị bỏ hẳn (không còn retry được). */
  const mutateWith = useCallback(
    (onSuccess?: (result: TurnResult) => void, onDiscard?: () => void) => {
      mutation.mutate(undefined, {
        onSuccess,
        onError: () => {
          if (!pending.current) onDiscard?.();
        },
      });
    },
    [mutation],
  );

  /** Gửi lượt mới: tạo key mới, gắn revision đang hiển thị. */
  const submit = useCallback(
    (
      draft: TurnDraft,
      expectedRevision: number,
      onSuccess?: (result: TurnResult) => void,
      onDiscard?: () => void,
    ) => {
      pending.current = {
        ...draft,
        expected_revision: expectedRevision,
        idempotency_key: newIdempotencyKey('turn'),
      } as ChatTurnInput;
      mutateWith(onSuccess, onDiscard);
    },
    [mutateWith],
  );

  /** Thử lại lượt lỗi: giữ nguyên key và payload. */
  const retry = useCallback(
    (onSuccess?: (result: TurnResult) => void, onDiscard?: () => void) => {
      if (!pending.current) return;
      mutateWith(onSuccess, onDiscard);
    },
    [mutateWith],
  );

  return {
    submit,
    retry,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
