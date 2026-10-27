import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatMessageItem } from './chat-message-item';
import { parseBlock } from '../schemas/blocks';

describe('ChatMessageItem', () => {
  it('hiển thị tin nhắn người dùng với bubble trắng và avatar người dùng ở bên phải', () => {
    render(<ChatMessageItem role="user" text="Chào trợ lý, mình muốn tìm hiểu ngành CNTT" />);

    expect(screen.getByText('Chào trợ lý, mình muốn tìm hiểu ngành CNTT')).toBeInTheDocument();
    const avatar = screen.getByAltText('Avatar người dùng');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', expect.stringContaining('user-avatar.png'));
  });

  it('hiển thị tin nhắn trợ lý với avatar bot và các nút tương tác', async () => {
    const text = 'Chào bạn! Mình sẵn sàng hỗ trợ bạn.';
    const block = parseBlock({
      block_id: 'b-test-1',
      type: 'text',
      schema_version: 1,
      content: text,
    });

    render(<ChatMessageItem role="bot" block={block} />);

    expect(screen.getByText(text)).toBeInTheDocument();
    const avatar = screen.getByAltText('Avatar trợ lý');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', expect.stringContaining('bot-avatar.png'));

    // Các nút Copy, Hài lòng, Chưa hài lòng
    const copyBtn = screen.getByRole('button', { name: 'Sao chép' });
    const thumbsUpBtn = screen.getByRole('button', { name: 'Hài lòng' });
    const thumbsDownBtn = screen.getByRole('button', { name: 'Chưa hài lòng' });

    expect(copyBtn).toBeInTheDocument();
    expect(thumbsUpBtn).toBeInTheDocument();
    expect(thumbsDownBtn).toBeInTheDocument();

    // Test sao chép
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
    expect(await screen.findByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();

    // Test toggle phản hồi hài lòng
    fireEvent.click(thumbsUpBtn);
    expect(thumbsUpBtn).toHaveClass('text-emerald-600');

    // Test chuyển sang chưa hài lòng
    fireEvent.click(thumbsDownBtn);
    expect(thumbsDownBtn).toHaveClass('text-rose-600');
    expect(thumbsUpBtn).not.toHaveClass('text-emerald-600');
  });

  it('hỗ trợ ẩn avatar khi là block tiếp nối của cùng một lượt bot', () => {
    render(<ChatMessageItem role="bot" text="Nội dung nối tiếp" showAvatar={false} />);

    expect(screen.getByText('Nội dung nối tiếp')).toBeInTheDocument();
    expect(screen.queryByAltText('Avatar trợ lý')).not.toBeInTheDocument();
  });
});
