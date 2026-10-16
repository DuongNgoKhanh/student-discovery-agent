'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-5xl space-y-3 p-6">
      <p>Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.</p>
      <button type="button" onClick={reset} className="rounded border px-4 py-2">
        Thử lại
      </button>
    </div>
  );
}
