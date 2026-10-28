'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
        className="rounded-full bg-[#4963a8] px-6 py-2 text-sm font-medium text-white shadow-md shadow-[#4963a8]/25 transition-all hover:scale-105 hover:bg-[#3d5492] active:scale-95 active:bg-[#34487d] dark:bg-[#4963a8] dark:text-white dark:hover:bg-[#3d5492]"
      >
        Bắt đầu
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
          <legend className="mb-1 text-sm font-medium">{clarification.title}</legend>
          {clarification.candidates.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2 text-left"
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
            >
              {c.label}
            </Button>
          ))}
        </fieldset>
      )}

      {question && !clarification && (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-1 break-words text-sm font-medium">{question.title}</legend>
          {question.options.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2 text-left"
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
            >
              {o.label}
            </Button>
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
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Sửa câu đã trả lời</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {answers.map((a) => {
          const options = a.question?.options ?? [];
          const current = options.find((o) => o.id === a.option_id)?.label ?? a.option_id;
          const isEditing = editing === a.question_id;
          return (
            <li key={a.answer_id} className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <span className="break-words">
                  Câu {a.ordinal}: {current}
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
                    <div role="alert" className="flex flex-col gap-2 rounded-md bg-amber-50 p-2">
                      <p className="text-amber-900">
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
