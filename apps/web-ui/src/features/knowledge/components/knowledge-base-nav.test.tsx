import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import { activeSection } from './kb-routes';
import { KnowledgeBaseBreadcrumb, KnowledgeBaseNav } from './knowledge-base-nav';

let pathname = '/admin/knowledge/kb1/settings';
let params: Record<string, string> = { kb: 'kb1' };
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useParams: () => params }));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { getBase: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

describe('KnowledgeBaseNav', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pathname = '/admin/knowledge/kb1/settings';
    params = { kb: 'kb1' };
    mocked.getBase.mockResolvedValue({
      id: 'kb1', name: 'Tuyển sinh 2026', description: '', embedding_model: 'gemini-embedding-2', document_count: 128, error_count: 2,
      created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
    });
  });

  it('nests the open knowledge base with its sections, the active one and index errors', async () => {
    renderWithProviders(<KnowledgeBaseNav />);
    const list = await screen.findByRole('list', { name: 'Mục của Tuyển sinh 2026' });
    expect(screen.getByText('Tuyển sinh 2026')).toBeInTheDocument();
    expect(list.querySelector('[aria-current="page"]')).toHaveTextContent('Cài đặt');
    expect(within(list).getByRole('link', { name: 'Tài liệu' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents');
    expect(within(list).getByRole('link', { name: /2 lỗi index/ })).toHaveAttribute('href', '/admin/knowledge/kb1/documents?state=error');
  });

  it('renders nothing outside a knowledge base', () => {
    pathname = '/admin/knowledge';
    params = {};
    const { container } = renderWithProviders(<KnowledgeBaseNav />);
    expect(container).toBeEmptyDOMElement();
    expect(mocked.getBase).not.toHaveBeenCalled();
  });

  it('shows a breadcrumb that links back from deeper pages', async () => {
    pathname = '/admin/knowledge/kb1/documents/hutech';
    renderWithProviders(<KnowledgeBaseBreadcrumb kb="kb1" />);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(await within(crumbs).findByRole('link', { name: 'Tuyển sinh 2026' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents');
    expect(within(crumbs).getByRole('link', { name: 'Tài liệu' })).toBeInTheDocument();
  });

  it('keeps "Tài liệu" active inside the document editor', () => {
    expect(activeSection('/admin/knowledge/kb1/documents/hutech')).toBe('documents');
    expect(activeSection('/admin/knowledge/kb1')).toBeUndefined();
  });
});
