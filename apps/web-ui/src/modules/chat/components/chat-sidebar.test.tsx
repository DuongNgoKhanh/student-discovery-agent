import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatSidebar, type ChatThreadItem } from './chat-sidebar';

const mockThreads: ChatThreadItem[] = [
  { id: 't1', title: 'Cuộc trò chuyện 1', time: 'Vừa xong' },
  { id: 't2', title: 'Cuộc trò chuyện 2', time: '1 giờ trước' },
];

describe('ChatSidebar', () => {
  it('renders threads and triggers events when expanded', () => {
    const onNewChat = vi.fn();
    const onSelectChat = vi.fn();
    const onDeleteChat = vi.fn();
    const onCloseMobile = vi.fn();
    const onToggleDesktop = vi.fn();

    render(
      <ChatSidebar
        threads={mockThreads}
        activeThreadId="t1"
        isMobileSidebarOpen={false}
        isDesktopSidebarOpen={true}
        userName="Nguyễn Văn A"
        onNewChat={onNewChat}
        onSelectChat={onSelectChat}
        onDeleteChat={onDeleteChat}
        onCloseMobileSidebar={onCloseMobile}
        onToggleDesktopSidebar={onToggleDesktop}
      />,
    );

    expect(screen.getByText('localis-ai')).toBeInTheDocument();
    expect(screen.getByText('student-discovery-agent')).toBeInTheDocument();
    expect(screen.getByAltText('IHRD Logo')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('Cuộc trò chuyện 1')).toBeInTheDocument();
    expect(screen.getByText('Cuộc trò chuyện 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cuộc trò chuyện mới/i }));
    expect(onNewChat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Cuộc trò chuyện 2'));
    expect(onSelectChat).toHaveBeenCalledWith('t2');

    const deleteButtons = screen.getAllByTitle('Xóa cuộc trò chuyện');
    fireEvent.click(deleteButtons[0]!);
    expect(onDeleteChat).toHaveBeenCalledWith('t1');
  });

  it('renders collapsed state when isDesktopSidebarOpen is false', () => {
    const onNewChat = vi.fn();
    const onToggleDesktop = vi.fn();

    render(
      <ChatSidebar
        threads={mockThreads}
        activeThreadId="t1"
        isMobileSidebarOpen={false}
        isDesktopSidebarOpen={false}
        onNewChat={onNewChat}
        onCloseMobileSidebar={vi.fn()}
        onToggleDesktopSidebar={onToggleDesktop}
      />,
    );

    fireEvent.click(screen.getByTitle('Mở sidebar'));
    expect(onToggleDesktop).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('IHRD Logo')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Cuộc trò chuyện mới'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('renders mobile close button when mobile sidebar is open', () => {
    const onCloseMobile = vi.fn();

    render(
      <ChatSidebar
        threads={mockThreads}
        activeThreadId="t1"
        isMobileSidebarOpen={true}
        isDesktopSidebarOpen={true}
        onNewChat={vi.fn()}
        onCloseMobileSidebar={onCloseMobile}
        onToggleDesktopSidebar={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đóng thanh bên' }));
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });
});
