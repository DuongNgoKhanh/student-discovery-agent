import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from './admin-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/knowledge' }));

describe('AdminShell', () => {
  it('marks the current section in the app sidebar', () => {
    render(<AdminShell account={<span>Quản trị viên</span>}><p>nội dung</p></AdminShell>);
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Người dùng' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('nội dung')).toBeInTheDocument();
  });
});
