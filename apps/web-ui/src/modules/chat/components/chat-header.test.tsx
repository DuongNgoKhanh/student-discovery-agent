import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatHeader } from './chat-header';

describe('ChatHeader', () => {
  it('renders title and subtitle', () => {
    render(
      <ChatHeader
        title="Trò chuyện hướng nghiệp"
        subtitle="Đang hoạt động"
        isDesktopSidebarOpen={true}
        onToggleMobileSidebar={vi.fn()}
        onToggleDesktopSidebar={vi.fn()}
      />,
    );

    expect(screen.getByText('Trò chuyện hướng nghiệp')).toBeInTheDocument();
    expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
  });

  it('handles sidebar toggles', () => {
    const onToggleMobile = vi.fn();
    const onToggleDesktop = vi.fn();

    render(
      <ChatHeader
        title="Trò chuyện hướng nghiệp"
        isDesktopSidebarOpen={true}
        onToggleMobileSidebar={onToggleMobile}
        onToggleDesktopSidebar={onToggleDesktop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mở thanh bên' }));
    expect(onToggleMobile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Đóng sidebar' }));
    expect(onToggleDesktop).toHaveBeenCalledTimes(1);
  });

  it('toggles theme between dark and light', () => {
    render(
      <ChatHeader
        title="Trò chuyện hướng nghiệp"
        isDesktopSidebarOpen={false}
        onToggleMobileSidebar={vi.fn()}
        onToggleDesktopSidebar={vi.fn()}
      />,
    );

    const themeBtn = screen.getByRole('button', { name: 'Chuyển chế độ màu' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
