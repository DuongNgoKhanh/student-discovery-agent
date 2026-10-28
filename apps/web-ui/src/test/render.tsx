import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

export const testQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** The app-level providers a component expects (React Query + Radix tooltips), without the toaster. */
export function TestProviders({ children, client }: { children: React.ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? testQueryClient());
  return <QueryClientProvider client={queryClient}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>;
}

export function renderWithProviders(ui: React.ReactElement, { client, ...options }: Omit<RenderOptions, 'wrapper'> & { client?: QueryClient } = {}) {
  const queryClient = client ?? testQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <TestProviders client={queryClient}>{children}</TestProviders>;
  return { client: queryClient, ...render(ui, { wrapper, ...options }) };
}
