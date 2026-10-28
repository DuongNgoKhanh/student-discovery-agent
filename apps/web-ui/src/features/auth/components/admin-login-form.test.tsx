import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/errors';
import { AdminLoginForm, adminNext } from './admin-login-form';

const mockReplace = vi.fn();
const mockGetSearchParams = vi.fn();
const mockMutateAsync = vi.fn();
let mockError: Error | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => mockGetSearchParams(key) }),
}));

vi.mock('../hooks/use-admin-login', () => ({
  useAdminLogin: () => ({ mutateAsync: mockMutateAsync, isPending: false, error: mockError }),
}));

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('AdminLoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockError = null;
    mockGetSearchParams.mockReturnValue(null);
  });

  it('hiển thị ô tên đăng nhập và mật khẩu với autocomplete phù hợp', () => {
    render(<AdminLoginForm />);
    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập Studio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tên đăng nhập')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('báo lỗi khi bỏ trống, không gọi API', async () => {
    render(<AdminLoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText('Vui lòng nhập tên đăng nhập')).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('đăng nhập thành công thì về trang đích trong admin', async () => {
    mockGetSearchParams.mockReturnValue('/admin/knowledge');
    mockMutateAsync.mockResolvedValue(undefined);
    render(<AdminLoginForm />);
    fillAndSubmit();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/admin/knowledge'));
  });

  it('sai thông tin thì không chuyển trang', async () => {
    mockMutateAsync.mockRejectedValue(new Error('x'));
    render(<AdminLoginForm />);
    fillAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('hiển thị thông điệp tiếng Việt cho 401', () => {
    mockError = new ApiError({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials provided', httpStatus: 401 });
    render(<AdminLoginForm />);
    expect(screen.getByRole('alert')).toHaveTextContent('Tên đăng nhập hoặc mật khẩu không đúng.');
  });
});

describe('adminNext', () => {
  it.each([
    [null, '/admin/agent'],
    ['/admin/knowledge/kb-1', '/admin/knowledge/kb-1'],
    ['/dashboard', '/admin/agent'],
    ['/admin/login', '/admin/agent'],
    ['/administrator', '/admin/agent'],
    ['//evil.com', '/admin/agent'],
  ])('%s → %s', (input, expected) => {
    expect(adminNext(input)).toBe(expected);
  });
});
