import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PASSWORD_POLICY_HINT } from '@/features/auth';
import { RegisterForm } from './register-form';

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
    useRegister: () => ({
      mutateAsync: mockMutateAsync,
      isPending: mockIsPending,
      error: mockError,
    }),
  };
});

const VALID_PASSWORD = 'MatKhau1!';

function fillAndSubmit({
  name = 'Nguyễn Ngân',
  email = 'hocsinh@example.com',
  password = VALID_PASSWORD,
} = {}) {
  fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
}

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending = false;
    mockError = null;
    mockGetSearchParams.mockReturnValue(null);
  });

  it('hiển thị các ô đăng ký, gợi ý chính sách mật khẩu và link Đăng nhập', () => {
    render(<RegisterForm />);

    expect(screen.getByRole('heading', { level: 1, name: 'Tạo tài khoản' })).toBeInTheDocument();
    expect(screen.getByLabelText('Họ và tên')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-describedby', 'password-hint');
    expect(screen.getByText(PASSWORD_POLICY_HINT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });

  it('mật khẩu không đủ chính sách backend bị chặn ở client', async () => {
    render(<RegisterForm />);
    fillAndSubmit({ password: 'matkhau123' });

    expect(await screen.findByText('Mật khẩu cần ít nhất một chữ hoa')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-invalid', 'true');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('báo lỗi email sai định dạng', async () => {
    render(<RegisterForm />);
    fillAndSubmit({ email: 'abc' });

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('đăng ký thành công chuyển về /dashboard mặc định', async () => {
    mockMutateAsync.mockResolvedValueOnce({});
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Nguyễn Ngân',
      email: 'hocsinh@example.com',
      password: VALID_PASSWORD,
    });
  });

  it('next an toàn được dùng để chuyển hướng và chuyển tiếp sang link Đăng nhập', async () => {
    mockGetSearchParams.mockReturnValue('/chat');
    mockMutateAsync.mockResolvedValueOnce({});
    render(<RegisterForm />);

    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute(
      'href',
      '/login?next=%2Fchat',
    );
    fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat'));
  });

  it('next không an toàn bị bỏ', async () => {
    mockGetSearchParams.mockReturnValue('https://evil.com');
    mockMutateAsync.mockResolvedValueOnce({});
    render(<RegisterForm />);

    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
    fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });

  it('đăng ký thất bại không chuyển trang', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Email đã được sử dụng'));
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('đang gửi: nút bị khoá và hiện Đang xử lý...', () => {
    mockIsPending = true;
    render(<RegisterForm />);
    expect(screen.getByRole('button', { name: 'Đang xử lý...' })).toBeDisabled();
  });

  it('hiển thị lỗi từ mutation', () => {
    mockError = new Error('Email đã được sử dụng');
    render(<RegisterForm />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email đã được sử dụng');
  });
});
