import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/client';
import { ChatShell } from './chat-shell';
import { BlockRenderer } from './block-renderer';
import { FIXTURE_QUESTIONS, GREETING_TEXT } from '../fixtures';
import { parseBlock } from '../schemas/blocks';

function renderShell() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ChatShell />
    </QueryClientProvider>,
  );
}

const TIMEOUT = { timeout: 4000 };

describe('ChatShell với mock', () => {
  it('hiển thị lời chào và nút bắt đầu', async () => {
    renderShell();
    expect(await screen.findByText(GREETING_TEXT, {}, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
  });

  it('đi hết luồng: tên, trả lời, tiến độ tăng đúng một lần', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));

    const nameInput = await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT);
    fireEvent.change(nameInput, { target: { value: 'Ngân 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByRole('alert', {}, TIMEOUT)).toHaveTextContent('chỉ gồm chữ cái');

    fireEvent.change(nameInput, { target: { value: '  Nguyễn   Ngân ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    const q1 = FIXTURE_QUESTIONS[0]!;
    const option = await screen.findByRole('button', { name: q1.options[0]!.label }, TIMEOUT);
    fireEvent.click(option);

    // Câu 2 xuất hiện và tiến độ là 1/6 (lượt trả lời đã commit).
    expect(
      await screen.findByRole('group', { name: FIXTURE_QUESTIONS[1]!.title }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tiến độ 1\/6/)).toBeInTheDocument();
  });

  it('sửa câu đã trả lời phải qua bước cảnh báo trước khi gửi', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));
    fireEvent.change(await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT), {
      target: { value: 'Ngân' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    fireEvent.click(
      await screen.findByRole('button', { name: FIXTURE_QUESTIONS[0]!.options[0]!.label }, TIMEOUT),
    );
    await screen.findByRole('group', { name: FIXTURE_QUESTIONS[1]!.title }, TIMEOUT);

    fireEvent.click(await screen.findByText('Sửa câu đã trả lời', {}, TIMEOUT));
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: FIXTURE_QUESTIONS[0]!.options[1]!.label }));

    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('phải trả lời lại');
    expect(within(warning).getByRole('button', { name: 'Xác nhận sửa' })).toBeInTheDocument();
  });
});

describe('BlockRenderer', () => {
  it('block không hỗ trợ hiển thị thông báo, không làm hỏng trang', () => {
    const block = parseBlock({ block_id: 'b1', type: 'chart', schema_version: 1 });
    render(<BlockRenderer block={block} />);
    expect(screen.getByRole('note')).toHaveTextContent('phiên bản mới hơn');
  });

  it('markup trong text được hiển thị nguyên văn, không thành phần tử HTML', () => {
    const markup = '<img src=x onerror="alert(1)"><b>đậm</b>';
    const block = parseBlock({ block_id: 'b2', type: 'text', schema_version: 1, content: markup });
    const { container } = render(<BlockRenderer block={block} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(markup)).toBeInTheDocument();
  });

  it('thẻ demo có nhãn Demo', () => {
    const block = parseBlock({
      block_id: 'b3',
      type: 'personality_card',
      schema_version: 1,
      activity_id: 'act_1',
      result_id: 'res_1',
      result_revision: 1,
      data: {
        display_name: 'Ngân',
        house: { house_id: 'h1', name: 'Hệ A', theme_ref: 't1', mascot_ref: 'm1' },
        strengths: ['Điều phối'],
        tendencies: ['Nhóm'],
        career_groups: ['Nhóm nghề'],
        quote: 'Nội dung thử nghiệm',
        is_demo: true,
      },
    });
    render(<BlockRenderer block={block} />);
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Thẻ tính cách' })).toBeInTheDocument();
  });
});
