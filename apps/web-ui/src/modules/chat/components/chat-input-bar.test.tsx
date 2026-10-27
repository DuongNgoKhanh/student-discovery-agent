import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInputBar } from './chat-input-bar';

describe('ChatInputBar', () => {
  it('renders input with default placeholder and action buttons', () => {
    render(<ChatInputBar onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('Hỏi ChatGPT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm tùy chọn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suy luận' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhập bằng giọng nói' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi âm giọng nói' })).toBeInTheDocument();
  });

  it('custom placeholder is applied', () => {
    render(<ChatInputBar onSend={vi.fn()} placeholder="Hỏi trợ lý hướng nghiệp" />);

    expect(screen.getByPlaceholderText('Hỏi trợ lý hướng nghiệp')).toBeInTheDocument();
  });

  it('submits text and clears input on form submit', () => {
    const onSend = vi.fn();
    render(<ChatInputBar onSend={onSend} />);

    const input = screen.getByPlaceholderText('Hỏi ChatGPT');
    fireEvent.change(input, { target: { value: 'Xin chào trợ lý' } });

    // Khi có text, nút tròn chuyển thành "Gửi tin nhắn"
    const submitBtn = screen.getByRole('button', { name: 'Gửi tin nhắn' });
    fireEvent.click(submitBtn);

    expect(onSend).toHaveBeenCalledWith('Xin chào trợ lý');
    expect(input).toHaveValue('');
  });

  it('does not submit when text is only whitespace', () => {
    const onSend = vi.fn();
    render(<ChatInputBar onSend={onSend} />);

    const input = screen.getByPlaceholderText('Hỏi ChatGPT');
    fireEvent.change(input, { target: { value: '   ' } });

    fireEvent.submit(input.closest('form')!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('triggers additional button callbacks when clicked', () => {
    const onPlusClick = vi.fn();
    const onReasoningClick = vi.fn();
    const onMicClick = vi.fn();

    render(
      <ChatInputBar
        onSend={vi.fn()}
        onPlusClick={onPlusClick}
        onReasoningClick={onReasoningClick}
        onMicClick={onMicClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thêm tùy chọn' }));
    expect(onPlusClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Suy luận' }));
    expect(onReasoningClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Nhập bằng giọng nói' }));
    expect(onMicClick).toHaveBeenCalledTimes(1);
  });

  it('disables input and buttons when disabled prop is true', () => {
    render(<ChatInputBar onSend={vi.fn()} disabled={true} />);

    expect(screen.getByPlaceholderText('Hỏi ChatGPT')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thêm tùy chọn' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suy luận' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nhập bằng giọng nói' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ghi âm giọng nói' })).toBeDisabled();
  });
});
