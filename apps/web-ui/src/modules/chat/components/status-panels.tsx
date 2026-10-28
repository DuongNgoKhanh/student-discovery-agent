import { Button } from '@/components/ui/button';

/** Trạng thái tải, lỗi, chưa cấu hình và phiên đóng (FR-UI-04). Không dựng luồng giả khi thiếu dữ liệu. */

export function LoadingPanel() {
  return (
    <p role="status" className="py-8 text-center text-sm text-muted-foreground">
      Đang tải...
    </p>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4"
    >
      <p className="break-words text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function NotConfiguredPanel() {
  return (
    <div role="status" className="rounded-lg border p-4 text-sm">
      <p className="font-medium">Trò chuyện chưa sẵn sàng</p>
      <p className="mt-1 text-muted-foreground">
        Hệ thống chưa được cấu hình để bắt đầu trò chuyện. Vui lòng quay lại sau.
      </p>
    </div>
  );
}

export function EndedPanel({ reason, onNewSession }: { reason: string; onNewSession: () => void }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <p className="text-muted-foreground">{reason}</p>
      <Button onClick={onNewSession}>Bắt đầu phiên mới</Button>
    </div>
  );
}
