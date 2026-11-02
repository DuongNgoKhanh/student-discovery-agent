import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInputBar } from './chat-input-bar';

describe('ChatInputBar', () => {
  it('renders input with default placeholder and send button', () => {
    render(<ChatInputBar onSend={vi.fn()} />);

    expect(screen.getByPlaceholderText('Nhập vào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeInTheDocument();
  });

  it('supports custom accessible label and placeholder', () => {
    render(
      <ChatInputBar
        onSend={vi.fn()}
        label="Nhập câu trả lời bằng chữ"
        placeholder="Hỏi trợ lý hướng nghiệp"
      />,
    );

    expect(screen.getByLabelText('Nhập câu trả lời bằng chữ')).toBeInTheDocument();
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
