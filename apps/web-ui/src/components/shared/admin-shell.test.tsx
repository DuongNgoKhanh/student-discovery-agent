import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdminShell } from './admin-shell';

let pathname = '/admin/knowledge';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const renderShell = () => render(
  <TooltipProvider>
    <AdminShell account={<span>Quản trị viên</span>} knowledgeNav={<p>nhóm KB</p>}><p>nội dung</p></AdminShell>
  </TooltipProvider>,
);

describe('AdminShell', () => {
  it('marks the current section in the app sidebar', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Knowledge Base' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Người dùng' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('nội dung')).toBeInTheDocument();
    expect(screen.getByText('nhóm KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở menu' })).toBeInTheDocument();
  });

  it('leaves "page" to the nested item inside a knowledge base', () => {
    pathname = '/admin/knowledge/kb1/documents';
    renderShell();
    expect(screen.getByRole('link', { name: 'Knowledge Base' })).not.toHaveAttribute('aria-current');
  });
});
