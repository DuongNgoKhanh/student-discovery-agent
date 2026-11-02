import { AlertCircle, CircleSlash, Loader2, RotateCcw, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Trạng thái tải, lỗi, chưa cấu hình và phiên đóng (FR-UI-04). Không dựng luồng giả khi thiếu dữ liệu. */

export function LoadingPanel() {
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Đang tải...
    </p>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive-subtle p-3.5"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words pt-0.5 text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function NotConfiguredPanel() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center text-sm"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
        <Wrench className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="text-base font-semibold">Trò chuyện chưa sẵn sàng</p>
      <p className="max-w-sm text-muted-foreground">
        Hệ thống chưa được cấu hình để bắt đầu trò chuyện. Vui lòng quay lại sau.
      </p>
    </div>
  );
}

export function EndedPanel({ reason, onNewSession }: { reason: string; onNewSession: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center text-sm dark:border-white/10 dark:bg-edge/40 sm:flex-row sm:text-left"
    >
      <CircleSlash className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="flex-1 text-muted-foreground">{reason}</p>
      <Button onClick={onNewSession} className="rounded-xl">
        Bắt đầu phiên mới
      </Button>
    </div>
  );
}
