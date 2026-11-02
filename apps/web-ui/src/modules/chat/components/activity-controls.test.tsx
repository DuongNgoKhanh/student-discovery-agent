import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityControls } from './activity-controls';
import type { ActivityView } from '../schemas/activity';
import type { ConversationView } from '../schemas/conversation';

const OPTIONS = [
  { id: 'a', label: 'Hoàn toàn không' },
  { id: 'b', label: 'Không lắm' },
  { id: 'c', label: 'Bình thường' },
];

function activity(questionId: string, title: string): ActivityView {
  return {
    id: 'act_1',
    conversation_id: 'conv_1',
    type: 'personality_assessment_adaptive',
    schema_version: 2,
    status: 'in_progress',
    revision: 1,
    display_name: 'Minh',
    progress: { completed: 0, total: null, min_total: 12, max_total: 15 },
    current_question: { question_id: questionId, title, options: OPTIONS },
    clarification: null,
    answers: [],
    result: null,
    is_demo: true,
  };
}

const conversation = {
  id: 'conv_1',
  schema_version: 1,
  status: 'active',
  revision: 1,
  agent_release_id: 'rel_1',
  display_name: 'Minh',
  active_activity: null,
  created_at: '2026-11-02T00:00:00Z',
  expires_at: '2026-11-03T00:00:00Z',
} satisfies ConversationView;

function controls(view: ActivityView) {
  return (
    <ActivityControls
      conversation={conversation}
      activity={view}
      disabled={false}
      send={vi.fn()}
      onNewSession={vi.fn()}
    />
  );
}

describe('ActivityControls', () => {
  it('câu mới tạo lại nút đáp án: đáp án vừa bấm ở câu trước không còn focus', () => {
    const { rerender } = render(controls(activity('q1', 'Câu một?')));
    const previous = screen.getByRole('button', { name: /Không lắm/ });
    previous.focus();
    expect(previous).toHaveFocus();

    rerender(controls(activity('q2', 'Câu hai?')));

    expect(previous).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Không lắm/ })).not.toHaveFocus();
  });

  it('câu hỏi chỉ còn cho trình đọc màn hình, không lặp lại tiêu đề hiển thị', () => {
    render(controls(activity('q1', 'Câu một?')));
    const group = screen.getByRole('group', { name: 'Câu một?' });
    expect(group.querySelector('legend')).toHaveClass('sr-only');
  });
});
