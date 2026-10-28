import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginForm } from './login-form';

const mockPush = vi.fn();
const mockGetSearchParams = vi.fn();
const mockMutateAsync = vi.fn();
let mockIsPending = false;
let mockError: Error | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => mockGetSearchParams(key),
  }),
}));

vi.mock('@/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth')>();
  return {
    ...actual,
    useLogin: () => ({
      mutateAsync: mockMutateAsync,
      isPending: mockIsPending,
      error: mockError,
    }),
  };
});

function fillAndSubmit(email = 'hocsinh@example.com', password = 'matkhau123') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending = false;
    mockError = null;
    mockGetSearchParams.mockReturnValue(null);
  });

  it('hiển thị ô email, mật khẩu và chỉ một hành động gửi', () => {
    render(<LoginForm />);

    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getAllByRole('button', { name: 'Đăng nhập' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute('href', '/register');
  });

  it('nút mắt ẩn/hiện mật khẩu và phản ánh trạng thái qua aria-pressed', () => {
    render(<LoginForm />);
    const password = screen.getByLabelText('Mật khẩu');
    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' });

    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lỗi validate gắn với ô nhập qua aria-invalid và aria-describedby', async () => {
    render(<LoginForm />);
    fillAndSubmit('abc', '123');

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'email-error');
    expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toHaveAttribute('id', 'password-error');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('đăng nhập thành công chuyển về /dashboard mặc định', async () => {
    mockMutateAsync.mockResolvedValueOnce({});
    render(<LoginForm />);
    fillAndSubmit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      email: 'hocsinh@example.com',
      password: 'matkhau123',
    });
  });

  it('next an toàn được dùng để chuyển hướng và chuyển tiếp sang link Đăng ký', async () => {
    mockGetSearchParams.mockReturnValue('/chat?x=1');
    mockMutateAsync.mockResolvedValueOnce({});
    render(<LoginForm />);

    expect(screen.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute(
      'href',
      '/register?next=%2Fchat%3Fx%3D1',
    );
    fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat?x=1'));
  });

  it('next không an toàn bị bỏ: về /dashboard và không chuyển tiếp', async () => {
    mockGetSearchParams.mockReturnValue('//evil.com');
    mockMutateAsync.mockResolvedValueOnce({});
    render(<LoginForm />);

    expect(screen.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute('href', '/register');
    fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });

  it('đăng nhập thất bại không chuyển trang', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Sai email hoặc mật khẩu'));
    render(<LoginForm />);
    fillAndSubmit();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('đang gửi: nút bị khoá và hiện Đang xử lý...', () => {
    mockIsPending = true;
    render(<LoginForm />);
    expect(screen.getByRole('button', { name: 'Đang xử lý...' })).toBeDisabled();
  });

  it('hiển thị lỗi từ mutation', () => {
    mockError = new Error('Sai email hoặc mật khẩu');
    render(<LoginForm />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sai email hoặc mật khẩu');
  });
});
