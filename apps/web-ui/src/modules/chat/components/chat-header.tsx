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
    <header className="z-10 flex h-[72px] shrink-0 items-center justify-between border-b border-slate-100 bg-transparent px-6 dark:border-white/5 lg:px-10">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="p-1 text-slate-500 hover:text-slate-900 dark:text-fog dark:hover:text-white md:hidden"
          aria-label="Mở thanh bên"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToggleDesktopSidebar}
          className="hidden items-center justify-center rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-fog dark:hover:bg-edge/40 dark:hover:text-white md:flex"
          title={isDesktopSidebarOpen ? 'Đóng sidebar' : 'Mở sidebar'}
          aria-label={isDesktopSidebarOpen ? 'Đóng sidebar' : 'Mở sidebar'}
        >
          {isDesktopSidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeft className="h-5 w-5" />
          )}
        </button>
        <div>
          <h1 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h1>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-fog/60">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" />{' '}
            {subtitle}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 dark:border-line dark:text-gray-300 dark:hover:bg-edge/40"
          title={isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
          aria-label="Chuyển chế độ màu"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          disabled
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors opacity-40 cursor-not-allowed dark:border-line dark:text-fog"
          aria-label="Tùy chọn khác"
          title="Tùy chọn khác (chưa khả dụng)"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
