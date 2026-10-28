'use client';

import { useState } from 'react';
import { ArrowRight, ChevronDown, Pencil, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { ActivityView, ActivityAnswer } from '../schemas/activity';
import type { ConversationView } from '../schemas/conversation';
import type { TurnDraft } from '../hooks/use-chat';
import { ChatInputBar } from './chat-input-bar';
import { EndedPanel } from './status-panels';
import { NameForm } from './name-form';

export type SendFn = (draft: TurnDraft, echo: string) => void;

interface Props {
  conversation: ConversationView;
  activity: ActivityView | null;
  disabled: boolean;
  send: SendFn;
  onNewSession: () => void;
}

/**
 * Khu thao tác duy nhất của học sinh. Mỗi lượt gửi kèm revision của conversation đang hiển thị.
 * Mọi lựa chọn đều lấy từ snapshot server, không suy ra từ transcript (FR-UI-02).
 */
export function ActivityControls({ conversation, activity, disabled, send, onNewSession }: Props) {
  if (conversation.status !== 'active') {
    return (
      <EndedPanel
        reason={conversation.status === 'expired' ? 'Phiên đã hết hạn.' : 'Phiên đã kết thúc.'}
        onNewSession={onNewSession}
      />
    );
  }

  if (activity && (activity.status === 'ended' || activity.status === 'expired')) {
    return (
      <EndedPanel
        reason={
          activity.status === 'expired' ? 'Bài đánh giá đã hết hạn.' : 'Bài đánh giá đã kết thúc.'
        }
        onNewSession={onNewSession}
      />
    );
  }

  if (!activity) {
    return (
      <Button
        disabled={disabled}
        onClick={() => send({ type: 'message', content: { text: 'Bắt đầu' } }, 'Bắt đầu')}
        className="group h-12 cursor-pointer rounded-xl px-7 text-base font-semibold shadow-md shadow-primary/20 transition-[background-color,transform,box-shadow] active:scale-[0.98]"
      >
        Bắt đầu
        <ArrowRight
          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Button>
    );
  }

  if (activity.status === 'collecting_name') {
    return (
      <NameForm
        disabled={disabled}
        onSubmit={(name) =>
          send(
            {
              type: 'interaction',
              activity_id: activity.id,
              action: 'set_name',
              payload: { display_name: name },
            },
            name,
          )
        }
      />
    );
  }

  const clarification = activity.status === 'in_progress' ? activity.clarification : null;
  const question = activity.status === 'in_progress' ? activity.current_question : null;

  return (
    <div className="flex flex-col gap-4">
      {clarification && (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-2.5 break-words text-[15px] font-semibold">{clarification.title}</legend>
          {clarification.candidates.map((c, index) => (
            <ChoiceButton
              key={c.id}
              index={index}
              label={c.label}
              onClick={() =>
                send(
                  {
                    type: 'interaction',
                    activity_id: activity.id,
                    action: 'confirm_answer',
                    payload: {
                      proposal_id: clarification.proposal_id,
                      question_id: clarification.question_id,
                      candidate_id: c.id,
                    },
                  },
                  c.label,
                )
              }
            />
          ))}
        </fieldset>
      )}

      {question && !clarification && (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-2.5 break-words text-[15px] font-semibold">{question.title}</legend>
          {question.options.map((o, index) => (
            <ChoiceButton
              key={o.id}
              index={index}
              label={o.label}
              onClick={() =>
                send(
                  {
                    type: 'interaction',
                    activity_id: activity.id,
                    action: 'submit_answer',
                    payload: { question_id: question.question_id, option_id: o.id },
                  },
                  o.label,
                )
              }
            />
          ))}
        </fieldset>
      )}

      {activity.answers.length > 0 && (
        <EditPanel
          answers={activity.answers}
          disabled={disabled}
          onConfirm={(questionId, optionId, label) =>
            send(
              {
                type: 'interaction',
                activity_id: activity.id,
                action: 'edit_answer',
                payload: { question_id: questionId, option_id: optionId },
              },
              `Sửa thành: ${label}`,
            )
          }
        />
      )}

      <FreeTextComposer
        disabled={disabled}
        onSend={(text) => send({ type: 'message', content: { text } }, text)}
      />
    </div>
  );
}

/** Sửa đáp án: hai bước, luôn cảnh báo các câu sau sẽ phải trả lời lại (FR-UI-03, QT-08). */
function EditPanel({
  answers,
  disabled,
  onConfirm,
}: {
  answers: ActivityAnswer[];
  disabled: boolean;
  onConfirm: (questionId: string, optionId: string, label: string) => void;
}) {
  const [target, setTarget] = useState<{
    questionId: string;
    optionId: string;
    label: string;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <details className="group/edit rounded-xl border border-border bg-muted/40 text-sm dark:border-white/10 dark:bg-white/[0.02]">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="flex-1">Sửa câu đã trả lời</span>
        <ChevronDown
          className="h-4 w-4 transition-transform duration-200 group-open/edit:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="flex flex-col gap-2 border-t border-border px-3.5 py-3 dark:border-white/10">
        {answers.map((a) => {
          const options = a.question?.options ?? [];
          const current = options.find((o) => o.id === a.option_id)?.label ?? a.option_id;
          const isEditing = editing === a.question_id;
          return (
            <li key={a.answer_id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="break-words">
                  <span className="font-medium text-muted-foreground">Câu {a.ordinal}:</span> {current}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setEditing(isEditing ? null : a.question_id);
                    setTarget(null);
                  }}
                >
                  Sửa
                </Button>
              </div>
              {isEditing && (
                <div className="flex flex-col gap-2 pl-2">
                  {options.map((o) => (
                    <Button
                      key={o.id}
                      variant="outline"
                      size="sm"
                      className="h-auto justify-start whitespace-normal py-2 text-left"
                      disabled={disabled}
                      onClick={() =>
                        setTarget({ questionId: a.question_id, optionId: o.id, label: o.label })
                      }
                    >
                      {o.label}
                    </Button>
                  ))}
                  {target?.questionId === a.question_id && (
                    <div
                      role="alert"
                      className="flex flex-col gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10"
                    >
                      <p className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        Các câu sau câu {a.ordinal} sẽ phải trả lời lại. Bạn có chắc muốn sửa?
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={disabled}
                          onClick={() => {
                            onConfirm(target.questionId, target.optionId, target.label);
                            setTarget(null);
                            setEditing(null);
                          }}
                        >
                          Xác nhận sửa
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
                          Hủy
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const CHOICE_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Lựa chọn trắc nghiệm: nhãn chữ cái chỉ để nhìn, tên truy cập vẫn là nội dung đáp án. */
function ChoiceButton({
  index,
  label,
  onClick,
}: {
  index: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/choice flex w-full cursor-pointer items-center gap-3 rounded-xl border border-input bg-card px-3.5 py-3 text-left text-sm leading-snug text-foreground shadow-sm',
        'transition-[border-color,background-color,box-shadow] duration-150 hover:border-primary/50 hover:bg-primary-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:hover:bg-card',
        'dark:border-white/10 dark:bg-ink',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground transition-colors group-hover/choice:bg-primary group-hover/choice:text-primary-foreground"
      >
        {CHOICE_KEYS[index] ?? index + 1}
      </span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </button>
  );
}

function FreeTextComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  return (
    <ChatInputBar
      disabled={disabled}
      onSend={onSend}
      label="Nhập câu trả lời bằng chữ"
      placeholder="Nhập vào"
    />
  );
}
