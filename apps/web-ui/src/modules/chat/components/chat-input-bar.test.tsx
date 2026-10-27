import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInputBar } from './chat-input-bar';

describe('ChatInputBar', () => {
  it('renders input with default placeholder and send button only', () => {
    render(<ChatInputBar onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('Nhập vào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeInTheDocument();

    // Các icon chức năng khác không tồn tại
    expect(screen.queryByRole('button', { name: 'Thêm tùy chọn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suy luận' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhập bằng giọng nói' })).not.toBeInTheDocument();
  });

  it('custom placeholder is applied', () => {
    render(<ChatInputBar onSend={vi.fn()} placeholder="Hỏi trợ lý hướng nghiệp" />);

    expect(screen.getByPlaceholderText('Hỏi trợ lý hướng nghiệp')).toBeInTheDocument();
  });

  it('submits text and clears input on form submit', () => {
    const onSend = vi.fn();
    render(<ChatInputBar onSend={onSend} />);

    const input = screen.getByPlaceholderText('Nhập vào');
    fireEvent.change(input, { target: { value: 'Xin chào trợ lý' } });

    const submitBtn = screen.getByRole('button', { name: 'Gửi tin nhắn' });
    fireEvent.click(submitBtn);

    expect(onSend).toHaveBeenCalledWith('Xin chào trợ lý');
    expect(input).toHaveValue('');
  });

  it('does not submit when text is only whitespace', () => {
    const onSend = vi.fn();
    render(<ChatInputBar onSend={onSend} />);

    const input = screen.getByPlaceholderText('Nhập vào');
    fireEvent.change(input, { target: { value: '   ' } });

    fireEvent.submit(input.closest('form')!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input and send button when disabled prop is true', () => {
    render(<ChatInputBar onSend={vi.fn()} disabled={true} />);

    expect(screen.getByPlaceholderText('Nhập vào')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled();
  });
});
