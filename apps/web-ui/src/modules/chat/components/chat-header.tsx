'use client';

import React, { useEffect, useState } from 'react';
import { Menu, MoreVertical, PanelLeftClose, PanelLeft, Sun, Moon } from 'lucide-react';

interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  isDesktopSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  onToggleDesktopSidebar: () => void;
}

export function ChatHeader({
  title,
  subtitle = 'Đang hoạt động',
  isDesktopSidebarOpen,
  onToggleMobileSidebar,
  onToggleDesktopSidebar,
}: ChatHeaderProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem('theme');
      if (
        savedTheme === 'dark' ||
        (!savedTheme && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
      ) {
        document.documentElement.classList.add('dark');
        setIsDark(true);
      } else {
        document.documentElement.classList.remove('dark');
        setIsDark(false);
      }
    } catch {
      setIsDark(document.documentElement.classList.contains('dark'));
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', nextDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  };

  return (
    <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-border/70 px-4 dark:border-white/5 md:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className={`${ICON_BUTTON_CLASS} md:hidden`}
          aria-label="Mở thanh bên"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleDesktopSidebar}
          className={`${ICON_BUTTON_CLASS} hidden md:flex`}
          title={isDesktopSidebarOpen ? 'Đóng sidebar' : 'Mở sidebar'}
          aria-label={isDesktopSidebarOpen ? 'Đóng sidebar' : 'Mở sidebar'}
        >
          {isDesktopSidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
          ) : (
            <PanelLeft className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
        <div className="ml-1 min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-foreground">{title}</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" aria-hidden="true" />
            {subtitle}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleTheme}
          className={ICON_BUTTON_CLASS}
          title={isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
          aria-label="Chuyển chế độ màu"
        >
          {isDark ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" /> : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
        </button>
        <button
          type="button"
          disabled
          className={ICON_BUTTON_CLASS}
          aria-label="Tùy chọn khác"
          title="Tùy chọn khác (chưa khả dụng)"
        >
          <MoreVertical className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

const ICON_BUTTON_CLASS =
  'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/5';
