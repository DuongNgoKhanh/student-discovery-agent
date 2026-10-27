import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { knowledgeApi } from '../api/knowledge';
import { activeSection, KnowledgeBaseShell } from './knowledge-base-shell';

let pathname = '/admin/knowledge/kb1/settings';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { getBase: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

describe('KnowledgeBaseShell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.getBase.mockResolvedValue({
      id: 'kb1', name: 'Tuyển sinh 2026', description: '', embedding_model: 'gemini-embedding-2', document_count: 128, error_count: 2,
      created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
    });
  });

  it('marks the current section and links to index errors', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider><KnowledgeBaseShell kb="kb1"><p>nội dung</p></KnowledgeBaseShell></TooltipProvider>
      </QueryClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Mục của knowledge base' });
    expect(await screen.findByText('128 tài liệu')).toBeInTheDocument();
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Cài đặt');
    expect(screen.getAllByRole('link', { name: /2 lỗi index/ })[0]).toHaveAttribute('href', '/admin/knowledge/kb1/documents?state=error');
  });

  it('keeps "Tài liệu" active inside the document editor', () => {
    pathname = '/admin/knowledge/kb1/documents/hutech';
    expect(activeSection(pathname)).toBe('documents');
    expect(activeSection('/admin/knowledge/kb1')).toBeUndefined();
  });
});
