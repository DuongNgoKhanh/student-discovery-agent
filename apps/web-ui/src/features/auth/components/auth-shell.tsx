import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { StudentAgentIllustration } from './student-agent-illustration';

/**
 * Khung chung của trang đăng nhập/đăng ký học sinh: panel thương hiệu IHRD bên trái, form bên phải.
 * Server component để hình minh hoạ không vào client bundle; trên mobile chỉ giữ thanh thương hiệu
 * để form nằm ngay màn hình đầu.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#7c9bff] p-3 sm:p-6 md:p-8">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white p-3 shadow-2xl shadow-indigo-950/20 sm:rounded-[36px] sm:p-4 md:flex-row md:p-5">
        <div className="relative flex shrink-0 flex-col justify-between overflow-hidden rounded-[22px] bg-[#4963a8] p-5 text-white sm:rounded-[28px] sm:p-8 md:w-[48%]">
          <Link
            href="/"
            className="group flex items-center gap-3 self-start transition-opacity hover:opacity-95"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm transition-transform group-hover:scale-105">
              <Image
                src="/Logo-IHRD.png"
                alt="Logo IHRD"
                width={36}
                height={36}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <div className="leading-tight text-white">
              <div className="text-sm font-bold tracking-tight">IHRD</div>
              <div className="text-[11px] text-blue-200">Khám phá hướng nghiệp</div>
            </div>
          </Link>

          <div className="my-6 hidden items-center justify-center md:flex">
            <StudentAgentIllustration />
          </div>

          <div className="hidden space-y-2 md:block">
            <p className="text-xl font-extrabold tracking-tight text-white sm:text-2xl lg:text-3xl">
              Khám phá hành trình nghề nghiệp của bạn.
            </p>
            <p className="max-w-md text-xs leading-relaxed text-blue-100/90 sm:text-sm">
              Đồng hành cùng Trợ lý AI Hướng nghiệp GenZ để khám phá tiềm năng, định hướng nghề
              nghiệp và xây dựng lộ trình tương lai vững chắc.
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-center px-4 py-6 sm:px-8 md:px-10 lg:px-12">
          {children}
        </div>
      </div>
    </div>
  );
}
