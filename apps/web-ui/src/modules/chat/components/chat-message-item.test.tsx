import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChatMessageItem } from './chat-message-item';
import { parseBlock } from '../schemas/blocks';

describe('ChatMessageItem', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.execCommand = originalExecCommand;
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it('hiển thị tin nhắn người dùng với bubble trắng và avatar người dùng ở bên phải', () => {
    render(<ChatMessageItem role="user" text="Chào trợ lý, mình muốn tìm hiểu ngành CNTT" />);

    expect(screen.getByText('Chào trợ lý, mình muốn tìm hiểu ngành CNTT')).toBeInTheDocument();
    const avatar = screen.getByAltText('Avatar người dùng');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', expect.stringContaining('user-avatar.png'));
  });

  it('hiển thị tin nhắn trợ lý với avatar bot và các nút tương tác', () => {
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

    expect(screen.getByRole('button', { name: 'Sao chép' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hài lòng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chưa hài lòng' })).toBeInTheDocument();
  });

  it('hỗ trợ ẩn avatar khi là block tiếp nối của cùng một lượt bot', () => {
    render(<ChatMessageItem role="bot" text="Nội dung nối tiếp" showAvatar={false} />);

    expect(screen.getByText('Nội dung nối tiếp')).toBeInTheDocument();
    expect(screen.queryByAltText('Avatar trợ lý')).not.toBeInTheDocument();
  });

  it('sao chép thành công qua navigator.clipboard và tự động hoàn tác sau 2 giây', async () => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    const text = 'Nội dung cần sao chép';
    render(<ChatMessageItem role="bot" text={text} />);

    const copyBtn = screen.getByRole('button', { name: 'Sao chép' });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(text);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: 'Sao chép' })).toBeInTheDocument();
  });

  it('fallback sang document.execCommand khi navigator.clipboard không hỗ trợ', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const execCommandSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandSpy;

    const text = 'Fallback execCommand copy';
    render(<ChatMessageItem role="bot" text={text} />);

    const copyBtn = screen.getByRole('button', { name: 'Sao chép' });
    fireEvent.click(copyBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();
  });

  it('fallback sang document.execCommand khi navigator.clipboard từ chối ghi', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
      writable: true,
      configurable: true,
    });
    const execCommandSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandSpy;

    render(<ChatMessageItem role="bot" text="Clipboard bị từ chối" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));

    expect(await screen.findByRole('button', { name: 'Đã sao chép' })).toBeInTheDocument();
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
  });

  it('textarea tạm được gỡ khỏi DOM kể cả khi execCommand ném lỗi', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    document.execCommand = vi.fn(() => {
      throw new Error('blocked');
    });

    render(<ChatMessageItem role="bot" text="execCommand ném lỗi" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));

    expect(await screen.findByRole('button', { name: 'Không thể sao chép' })).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('hiển thị trạng thái lỗi khi cả clipboard và fallback đều thất bại', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);

    render(<ChatMessageItem role="bot" text="Thất bại sao chép" />);

    const copyBtn = screen.getByRole('button', { name: 'Sao chép' });
    fireEvent.click(copyBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Không thể sao chép' })).toBeInTheDocument();
  });

  it('toggle phản hồi hài lòng và chưa hài lòng cập nhật aria-pressed và gọi onReact', () => {
    const onReact = vi.fn();
    render(<ChatMessageItem id="msg-1" role="bot" text="Nội dung bot" onReact={onReact} />);

    const thumbsUpBtn = screen.getByRole('button', { name: 'Hài lòng' });
    const thumbsDownBtn = screen.getByRole('button', { name: 'Chưa hài lòng' });

    expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'false');
    expect(thumbsDownBtn).toHaveAttribute('aria-pressed', 'false');

    // Click thumbs up
    fireEvent.click(thumbsUpBtn);
    expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'true');
    expect(thumbsDownBtn).toHaveAttribute('aria-pressed', 'false');
    expect(onReact).toHaveBeenCalledWith('msg-1', 'up');

    // Click thumbs down
    fireEvent.click(thumbsDownBtn);
    expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'false');
    expect(thumbsDownBtn).toHaveAttribute('aria-pressed', 'true');
    expect(onReact).toHaveBeenCalledWith('msg-1', 'down');

    // Click thumbs down again to unselect
    fireEvent.click(thumbsDownBtn);
    expect(thumbsDownBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
