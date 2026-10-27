import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NameForm } from './name-form';

describe('NameForm', () => {
  it('renders label, input with placeholder "Nhập vào" and send button', () => {
    render(<NameForm disabled={false} onSubmit={vi.fn()} />);

    expect(screen.getByText('Mình gọi bạn là gì nhỉ?')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Nhập vào');
    expect(input).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeInTheDocument();

    // Các icon chức năng phụ không xuất hiện
    expect(screen.queryByRole('button', { name: 'Thêm tùy chọn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suy luận' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhập bằng giọng nói' })).not.toBeInTheDocument();
  });

  it('submits valid name through onSubmit callback', async () => {
    const onSubmit = vi.fn();
    render(<NameForm disabled={false} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('Nhập vào');
    fireEvent.change(input, { target: { value: 'Minh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    // Form onSubmit is async through react-hook-form
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Minh');
    });
  });

  it('displays validation error when submitting invalid name', async () => {
    const onSubmit = vi.fn();
    render(<NameForm disabled={false} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('Nhập vào');
    fireEvent.change(input, { target: { value: 'Minh 123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    const error = await screen.findByRole('alert');
    expect(error).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables input and send button when disabled is true', () => {
    render(<NameForm disabled={true} onSubmit={vi.fn()} />);

    expect(screen.getByPlaceholderText('Nhập vào')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
  });
});
