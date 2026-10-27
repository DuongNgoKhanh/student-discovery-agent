import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending = false;
    mockError = null;
    mockGetSearchParams.mockReturnValue(null);
  });

  it('renders branding elements: IHRD logo, title, and career discovery hero', () => {
    render(<RegisterForm />);

    // Brand logo & subtext
    const logoImg = screen.getByAltText('IHRD Logo');
    expect(logoImg).toBeInTheDocument();
    expect(logoImg.getAttribute('src')).toContain('Logo-IHRD.png');
    expect(screen.getByText('localis-ai')).toBeInTheDocument();
    expect(screen.getByText('student-discovery-agent')).toBeInTheDocument();

    // Hero section text
    expect(screen.getByText('Start Your Career Journey.')).toBeInTheDocument();
    expect(
      screen.getByText(/Trợ lý AI Hướng nghiệp GenZ để khám phá tiềm năng/),
    ).toBeInTheDocument();

    // Log in pill button
    const loginLinks = screen.getAllByRole('link', { name: /log in/i });
    expect(loginLinks.length).toBeGreaterThanOrEqual(1);
    expect(loginLinks[0]).toHaveAttribute('href', '/login');
  });

  it('renders register form inputs, labels, and action buttons', () => {
    render(<RegisterForm />);

    expect(screen.getByRole('heading', { name: 'Create an Account' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sign up to start your journey, discover your strengths, and shape your future.',
      ),
    ).toBeInTheDocument();

    // Inputs
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('toggles password visibility when eye icon button is clicked', () => {
    render(<RegisterForm />);

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
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Email không hợp lệ')).toBeInTheDocument();
      expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync and redirects to /dashboard on valid submission', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Nguyen Van A' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Nguyen Van A',
        email: 'student@example.com',
        password: 'password123',
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('respects safe next query param redirect', async () => {
    mockGetSearchParams.mockReturnValue('/custom-page');
    mockMutateAsync.mockResolvedValueOnce(undefined);
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Nguyen Van A' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/custom-page');
    });
  });

  it('displays notice message when clicking Google Sign up', () => {
    render(<RegisterForm />);

    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }));
    expect(screen.getByText('Đăng ký với Google sẽ sớm được hỗ trợ.')).toBeInTheDocument();
  });

  it('displays error message from mutation when registration fails', () => {
    mockError = new Error('Email is already registered');
    render(<RegisterForm />);

    expect(screen.getByText('Email is already registered')).toBeInTheDocument();
  });
});
