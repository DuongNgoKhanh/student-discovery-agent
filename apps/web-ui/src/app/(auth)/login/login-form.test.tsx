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

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending = false;
    mockError = null;
    mockGetSearchParams.mockReturnValue(null);
  });

  it('renders branding elements: IHRD logo, title, and career discovery hero', () => {
    render(<LoginForm />);

    // Brand logo & subtext
    const logoImg = screen.getByAltText('IHRD Logo');
    expect(logoImg).toBeInTheDocument();
    expect(logoImg.getAttribute('src')).toContain('Logo-IHRD.png');
    expect(screen.getByText('localis-ai')).toBeInTheDocument();
    expect(screen.getByText('student-discovery-agent')).toBeInTheDocument();

    // Hero section text
    expect(screen.getByText('Welcome to Your Career Discovery.')).toBeInTheDocument();
    expect(
      screen.getByText(/Trợ lý AI Hướng nghiệp GenZ để khám phá tiềm năng/),
    ).toBeInTheDocument();

    // Sign up links
    const signUpLinks = screen.getAllByRole('link', { name: /sign up/i });
    expect(signUpLinks.length).toBeGreaterThanOrEqual(1);
    expect(signUpLinks[0]).toHaveAttribute('href', '/register');
  });

  it('renders login form inputs, labels, and action buttons', () => {
    render(<LoginForm />);

    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Log in to access your journey, track progress, and keep growing every day.',
      ),
    ).toBeInTheDocument();

    // Inputs
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('toggles password visibility when eye icon button is clicked', () => {
    render(<LoginForm />);

    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');

    const hideBtn = screen.getByRole('button', { name: 'Ẩn mật khẩu' });
    fireEvent.click(hideBtn);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('shows validation errors when submitting invalid email and short password', async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByText('Email không hợp lệ')).toBeInTheDocument();
      expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync and redirects to /dashboard on valid submission', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        email: 'student@example.com',
        password: 'password123',
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('respects safe next query param redirect', async () => {
    mockGetSearchParams.mockReturnValue('/custom-page');
    mockMutateAsync.mockResolvedValueOnce(undefined);
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/custom-page');
    });
  });

  it('displays notice message when clicking Google Login or Forgot Password', () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: /login with google/i }));
    expect(screen.getByText('Đăng nhập với Google sẽ sớm được hỗ trợ.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(
      screen.getByText('Tính năng đặt lại mật khẩu đang được phát triển.'),
    ).toBeInTheDocument();
  });

  it('displays error message from mutation when login fails', () => {
    mockError = new Error('Email hoặc mật khẩu không chính xác');
    render(<LoginForm />);

    expect(screen.getByText('Email hoặc mật khẩu không chính xác')).toBeInTheDocument();
  });
});
