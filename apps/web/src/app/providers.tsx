'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { makeQueryClient } from '@/lib/query/client';

export function Providers({ children }: { children: React.ReactNode }) {
  // Tạo 1 QueryClient/lần mount (tránh share state giữa các request khi SSR).
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
