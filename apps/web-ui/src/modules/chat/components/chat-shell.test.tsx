import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/client';
import { ChatShell } from './chat-shell';
import { BlockRenderer } from './block-renderer';
import { FIXTURE_QUESTIONS, GREETING_TEXT } from '../fixtures';
import { parseBlock } from '../schemas/blocks';
import { getChatApi } from '../api';
import { ApiError } from '@/lib/api/errors';

function renderShell() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ChatShell />
    </QueryClientProvider>,
  );
}

const TIMEOUT = { timeout: 4000 };

describe('ChatShell với mock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hiển thị lời chào và nút bắt đầu ở màn chào, không render composer nhập liệu', async () => {
    renderShell();
    expect(
      await screen.findByRole('heading', { level: 2, name: GREETING_TEXT }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled();
    // Ở màn chào chưa vào activity nên không render composer nhập text tự do
    expect(screen.queryByLabelText('Nhập câu trả lời bằng chữ')).not.toBeInTheDocument();
  });

  it('hội thoại expired hoặc ended ở màn chào: hiển thị Bắt đầu phiên mới', async () => {
    const api = getChatApi();
    vi.spyOn(api, 'createConversation').mockResolvedValueOnce({
      conversation: {
        id: 'conv_expired_test',
        schema_version: 1,
        status: 'expired',
        revision: 0,
        agent_release_id: 'release_test',
        display_name: null,
        active_activity: null,
        created_at: '2026-10-14T03:00:00Z',
        expires_at: '2026-10-14T04:00:00Z',
      },
      messageId: 'msg_expired',
      blocks: [
        {
          kind: 'known',
          block: {
            block_id: 'b_exp_1',
            type: 'text',
            schema_version: 1,
            content: 'Chào bạn! Phiên đã quá hạn.',
          },
        },
      ],
    });

    renderShell();

    // Do hội thoại expired, isInitial = false, ActivityControls render EndedPanel
    expect(
      await screen.findByRole('button', { name: 'Bắt đầu phiên mới' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByText('Phiên đã hết hạn.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('sau khi bấm Bắt đầu: heading lời chào biến mất, danh sách Hội thoại render bot blocks rồi đến echo Bắt đầu, và footer composer xuất hiện', async () => {
    renderShell();

    const greetingHeading = await screen.findByRole(
      'heading',
      { level: 2, name: GREETING_TEXT },
      TIMEOUT,
    );
    expect(greetingHeading).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: 'Bắt đầu' });
    fireEvent.click(startBtn);

    // 1. Heading lời chào biến mất
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    // 2. Danh sách Hội thoại hiển thị
    const list = await screen.findByRole('list', { name: 'Hội thoại' }, TIMEOUT);
    expect(list).toBeInTheDocument();

    // 3. Trong danh sách: bot block lời chào hiển thị trước, sau đó là echo 'Bắt đầu'
    expect(within(list).getByText(GREETING_TEXT)).toBeInTheDocument();
    expect(within(list).getByText('Bắt đầu', { selector: 'div' })).toBeInTheDocument();

    // 4. Footer composer xuất hiện (NameForm cho bước thu thập tên)
    expect(
      await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT),
    ).toBeInTheDocument();
  });

  it('số avatar bot bằng số nhóm tin bot liên tiếp (isConsecutiveBot)', async () => {
    const api = getChatApi();
    const originalSendTurn = api.sendTurn.bind(api);
    vi.spyOn(api, 'sendTurn').mockImplementationOnce(async (convId, input) => {
      const res = await originalSendTurn(convId, input);
      return {
        ...res,
        blocks: [
          {
            kind: 'known' as const,
            block: {
              block_id: 'b_consec_1',
              type: 'text' as const,
              schema_version: 1,
              content: 'Đoạn bot nối tiếp 1',
            },
          },
          {
            kind: 'known' as const,
            block: {
              block_id: 'b_consec_2',
              type: 'text' as const,
              schema_version: 1,
              content: 'Đoạn bot nối tiếp 2',
            },
          },
        ],
      };
    });

    renderShell();

    const startBtn = await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT);
    fireEvent.click(startBtn);

    const list = await screen.findByRole('list', { name: 'Hội thoại' }, TIMEOUT);
    expect(await within(list).findByText('Đoạn bot nối tiếp 1', {}, TIMEOUT)).toBeInTheDocument();
    expect(within(list).getByText('Đoạn bot nối tiếp 2')).toBeInTheDocument();

    // 3 tin nhắn bot: lời chào khởi tạo (1 avatar) và 2 tin bot nối tiếp liên tiếp (chỉ tin đầu có avatar)
    // => Tổng cộng đúng 2 avatar trợ lý cho 2 nhóm tin bot
    const botAvatars = within(list).getAllByAltText('Avatar trợ lý');
    expect(botAvatars).toHaveLength(2);
  });

  it('nút Cuộc trò chuyện mới reset về màn chào ban đầu', async () => {
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));
    expect(
      await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT),
    ).toBeInTheDocument();

    // Bấm nút "Cuộc trò chuyện mới" trên sidebar
    const newChatBtn = screen.getByRole('button', { name: /Cuộc trò chuyện mới/i });
    fireEvent.click(newChatBtn);

    // Màn hình reset về màn chào ban đầu với heading h2 và nút Bắt đầu
    expect(
      await screen.findByRole('heading', { level: 2, name: GREETING_TEXT }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeInTheDocument();
  });

  it('lượt bị bỏ hẳn (lỗi không retry được) thì gỡ echo của người dùng', async () => {
    const api = getChatApi();
    vi.spyOn(api, 'sendTurn').mockRejectedValueOnce(
      new ApiError({ code: 'VALIDATION_ERROR', message: 'Lượt không hợp lệ.', httpStatus: 400 }),
    );
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));

    expect(await screen.findByText('Lượt không hợp lệ.', {}, TIMEOUT)).toBeInTheDocument();
    // Không còn echo "Bắt đầu" giả như đã gửi: màn chào vẫn giữ nguyên.
    expect(screen.getByRole('heading', { level: 2, name: GREETING_TEXT })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Hội thoại' })).not.toBeInTheDocument();
  });

  it('lỗi retry được không đi theo sang hội thoại khác', async () => {
    const api = getChatApi();
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));
    await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT);

    vi.spyOn(api, 'sendTurn').mockRejectedValueOnce(
      new ApiError({ code: 'SYS_503', message: 'Mất kết nối.', retryable: true, httpStatus: 503 }),
    );
    fireEvent.change(screen.getByLabelText('Mình gọi bạn là gì nhỉ?'), {
      target: { value: 'Ngân' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByText('Mất kết nối.', {}, TIMEOUT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cuộc trò chuyện mới/i }));

    expect(
      await screen.findByRole('heading', { level: 2, name: GREETING_TEXT }, TIMEOUT),
    ).toBeInTheDocument();
    expect(screen.queryByText('Mất kết nối.')).not.toBeInTheDocument();
  });

  it('chọn lại thread cũ trên sidebar khôi phục đúng transcript của thread đó', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }, TIMEOUT));
    await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT);

    fireEvent.click(screen.getByRole('button', { name: /Cuộc trò chuyện mới/i }));
    await screen.findByRole('heading', { level: 2, name: GREETING_TEXT }, TIMEOUT);

    // Thread mới nhất đứng đầu; thread cũ là phần tử thứ hai.
    const threadButtons = await screen.findAllByRole('button', { name: /Vừa xong/ }, TIMEOUT);
    expect(threadButtons).toHaveLength(2);
    fireEvent.click(threadButtons[1]!);

    const list = await screen.findByRole('list', { name: 'Hội thoại' }, TIMEOUT);
    expect(within(list).getByText('Bắt đầu', { selector: 'div' })).toBeInTheDocument();
    expect(
      await screen.findByLabelText('Mình gọi bạn là gì nhỉ?', {}, TIMEOUT),
    ).toBeInTheDocument();
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
    expect(screen.getByRole('article', { name: 'Thẻ tính cách' })).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
});
