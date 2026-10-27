'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { registerSchema, type RegisterInput, useRegister } from '@/features/auth';
import { safeNext } from '@/lib/auth/safe-next';
import { Button } from '@/components/ui/button';
import { StudentAgentIllustration } from '../login/student-agent-illustration';

export function RegisterForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
  const { mutateAsync, isPending, error } = useRegister();

  async function onSubmit(values: RegisterInput) {
    setNotice(null);
    await mutateAsync(values);
    router.push(next);
  }

  function handleGoogleSignUp() {
    setNotice('Đăng ký với Google sẽ sớm được hỗ trợ.');
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#7c9bff] p-3 sm:p-6 md:p-8">
      {/* Centered White Card Container */}
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white p-3 shadow-2xl shadow-indigo-950/20 sm:rounded-[36px] sm:p-4 md:flex-row md:p-5">
        {/* Left Side: Student Agent Hero Panel */}
        <div className="relative flex shrink-0 flex-col justify-between overflow-hidden rounded-[22px] bg-[#4963a8] p-6 text-white sm:rounded-[28px] sm:p-8 md:w-[48%]">
          {/* Top Bar: Brand Logo & Log in Pill */}
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="group flex items-center gap-3 transition-opacity hover:opacity-95"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm transition-transform group-hover:scale-105">
                <Image
                  src="/Logo-IHRD.png"
                  alt="IHRD Logo"
                  width={36}
                  height={36}
                  priority
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="leading-tight text-white">
                <div className="text-sm font-bold tracking-tight">localis-ai</div>
                <div className="font-mono text-[10px] tracking-wider text-blue-200">
                  student-discovery-agent
                </div>
              </div>
            </Link>

            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full border border-white/40 px-4 py-1 text-xs font-medium text-white transition hover:border-white hover:bg-white/10 active:scale-95"
            >
              Log in
            </Link>
          </div>

          {/* Center Illustration: Student Discovery Agent */}
          <div className="my-6 flex items-center justify-center">
            <StudentAgentIllustration />
          </div>

          {/* Bottom Heading & Description */}
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl lg:text-3xl">
              Start Your Career Journey.
            </h2>
            <p className="max-w-md text-xs leading-relaxed text-blue-100/90 sm:text-sm">
              Đồng hành cùng Trợ lý AI Hướng nghiệp GenZ để khám phá tiềm năng, định hướng nghề
              nghiệp và xây dựng lộ trình tương lai vững chắc.
            </p>
          </div>
        </div>

        {/* Right Side: Register Form Panel */}
        <div className="flex flex-1 flex-col justify-center px-4 py-6 sm:px-8 md:px-10 lg:px-12">
          {/* Form Header */}
          <div className="mb-6 space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">
              Create an Account
            </h1>
            <p className="text-xs text-slate-500 sm:text-sm">
              Sign up to start your journey, discover your strengths, and shape your future.
            </p>
          </div>

          {/* Form Controls */}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Full Name Field */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-xs font-semibold text-slate-700">
                Full name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Enter your full name"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-[#4963a8] focus:outline-none focus:ring-2 focus:ring-[#4963a8]/20"
                {...register('name')}
              />
              {errors.name && (
                <p role="alert" className="text-xs text-rose-600">
                  {errors.name.message}
                </p>
              )}
            </div>

            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-[#4963a8] focus:outline-none focus:ring-2 focus:ring-[#4963a8]/20"
                {...register('email')}
              />
              {errors.email && (
                <p role="alert" className="text-xs text-rose-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 pr-10 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-[#4963a8] focus:outline-none focus:ring-2 focus:ring-[#4963a8]/20"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p role="alert" className="text-xs text-rose-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Sign up with Google Button */}
            <button
              type="button"
              onClick={handleGoogleSignUp}
              className="shadow-xs flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 active:scale-[0.99] sm:text-sm"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Sign up with Google</span>
            </button>

            {/* "or" Divider */}
            <div className="relative my-2 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <span className="relative bg-white px-3 text-xs text-slate-400">or</span>
            </div>

            {/* Primary Submit Button */}
            <Button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl bg-[#4963a8] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#4963a8]/20 transition hover:bg-[#3d5492] active:bg-[#34487d] disabled:opacity-60"
            >
              {isPending ? 'Đang xử lý...' : 'Create Account'}
            </Button>

            {/* Feedback Notices / Errors */}
            {notice && (
              <div
                role="status"
                className="rounded-lg bg-blue-50 p-2.5 text-center text-xs text-blue-700"
              >
                {notice}
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-lg bg-rose-50 p-2.5 text-center text-xs text-rose-700"
              >
                {(error as Error).message}
              </div>
            )}

            {/* Redirect link to Log in */}
            <p className="pt-2 text-center text-xs text-slate-500">
              Đã có tài khoản?{' '}
              <Link href="/login" className="font-semibold text-[#4963a8] underline">
                Log in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
