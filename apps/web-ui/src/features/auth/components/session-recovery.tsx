'use client';
import { useEffect } from 'react';
import { refreshSession } from '@/lib/api/client';
import { safeNext } from '@/lib/auth/safe-next';
/** Refresh stays in the browser: only it receives the narrow-path HttpOnly cookie. */
export function SessionRecovery() {
  useEffect(() => {
    let active = true;
    void refreshSession().then(ok => {
      if (!active) return;
      if (ok) window.location.reload();
      else window.location.replace(`/login?next=${encodeURIComponent(safeNext(window.location.pathname))}`);
    });
    return () => { active = false; };
  }, []);
  return <p role="status" className="p-6">Đang khôi phục phiên đăng nhập…</p>;
}
