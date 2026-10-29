import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

/**
 * Khung trang đăng nhập Agent Studio (khu vực quản trị). Dùng token của Studio thay vì panel
 * thương hiệu học sinh, để admin nhận ra ngay mình đang vào công cụ nội bộ chứ không phải trang học sinh.
 */
export function StudioAuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-card p-1.5 shadow-sm">
            <Image
              src="/Logo-IHRD.png"
              alt="Logo IHRD"
              width={32}
              height={32}
              priority
              className="h-full w-full object-contain"
            />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold text-brand">Agent Studio</div>
            <div className="text-xs text-muted-foreground">Khu vực quản trị IHRD</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">{children}</div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Bạn là học sinh?{' '}
          <Link href="/chat" className="font-medium text-primary underline-offset-4 hover:underline">
            Trò chuyện với trợ lý
          </Link>{' '}
          không cần đăng nhập.
        </p>
      </div>
    </div>
  );
}
