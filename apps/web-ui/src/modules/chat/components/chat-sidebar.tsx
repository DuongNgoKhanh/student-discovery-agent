'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { Plus, X, MessageSquare, ChevronsRight } from 'lucide-react';

export interface ChatThreadItem {
  id: string;
  title: string;
  time: string;
}

interface ChatSidebarProps {
  threads: ChatThreadItem[];
  activeThreadId: string;
  isMobileSidebarOpen: boolean;
  isDesktopSidebarOpen: boolean;
  userName?: string;
  disabled?: boolean;
  onNewChat: () => void;
  onSelectChat?: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  onCloseMobileSidebar: () => void;
  onToggleDesktopSidebar: () => void;
}

export function ChatSidebar({
  threads,
  activeThreadId,
  isMobileSidebarOpen,
  isDesktopSidebarOpen,
  userName = 'Học sinh',
  disabled = false,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onCloseMobileSidebar,
  onToggleDesktopSidebar,
}: ChatSidebarProps) {
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobileSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileSidebarOpen, onCloseMobileSidebar]);

  const isExpanded = isMobileSidebarOpen || isDesktopSidebarOpen;

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileSidebarOpen && (
        <div
          onClick={onCloseMobileSidebar}
          className="backdrop-blur-sm fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col rounded-3xl border border-slate-200/50 bg-slate-50 shadow-lg transition-all duration-300 dark:border-white/5 dark:bg-panel/80 md:static ${
          isMobileSidebarOpen
            ? 'm-4 w-[300px] translate-x-0 md:m-0'
            : `-translate-x-full invisible md:visible md:translate-x-0 ${isDesktopSidebarOpen ? 'md:w-[300px]' : 'md:w-[60px]'}`
        }`}
      >
        {!isExpanded ? (
          /* Collapsed Desktop Sidebar */
          <div className="flex h-full flex-col items-center gap-4 py-4">
            <button
              type="button"
              onClick={onToggleDesktopSidebar}
              className="cursor-pointer rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-200/50 hover:text-emerald-600 dark:text-fog dark:hover:bg-white/5 dark:hover:text-emerald-400"
              title="Mở sidebar"
            >
              <ChevronsRight className="h-5 w-5" />
            </button>

            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white">
              <Image
                src="/Logo-IHRD.png"
                alt="IHRD Logo"
                width={36}
                height={36}
                className="h-full w-full object-contain"
              />
            </div>

            <div className="my-1 h-px w-full bg-slate-200 dark:bg-line/60" />

            <button
              type="button"
              disabled={disabled}
              onClick={onNewChat}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-emerald-600/30 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-600/10"
              title="Cuộc trò chuyện mới"
            >
              <Plus className="h-5 w-5" />
            </button>

            <div className="no-scrollbar mt-2 flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
              {threads.map((item) => {
                const active = item.id === activeThreadId;
                if (!onSelectChat) {
                  return (
                    <div
                      key={item.id}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        active
                          ? 'bg-slate-200 text-emerald-600 dark:bg-edge/80 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-fog'
                      }`}
                      title={item.title}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </div>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectChat(item.id)}
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? 'bg-slate-200 text-emerald-600 dark:bg-edge/80 dark:text-emerald-400'
                        : 'text-slate-500 hover:bg-slate-200 dark:text-fog dark:hover:bg-edge/40'
                    }`}
                    title={item.title}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                );
              })}
            </div>

            <div className="mt-auto flex w-full flex-col items-center gap-3 border-t border-slate-200 pt-3 dark:border-line/50">
              <div
                className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-line dark:bg-edge"
                title={userName}
              >
                <Image
                  src="/user-avatar.png"
                  alt={userName}
                  width={32}
                  height={32}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        ) : (
          /* Expanded Sidebar */
          <>
            {/* Brand Logo */}
            <div className="border-b border-slate-200 p-4 dark:border-line/40">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white">
                  <Image
                    src="/Logo-IHRD.png"
                    alt="IHRD Logo"
                    width={36}
                    height={36}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                    IHRD
                  </div>
                  <div className="font-mono text-[10px] tracking-wider text-slate-500 dark:text-fog/70">
                    Khám phá hướng nghiệp
                  </div>
                </div>
              </div>
            </div>

            {/* New Chat Button */}
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-4">
              <button
                type="button"
                disabled={disabled}
                onClick={onNewChat}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-600/30 py-2.5 text-sm font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-600/80 dark:text-emerald-400 dark:hover:bg-emerald-600/10"
              >
                <Plus className="h-4 w-4" /> Cuộc trò chuyện mới
              </button>
              {isMobileSidebarOpen && (
                <button
                  type="button"
                  onClick={onCloseMobileSidebar}
                  className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-line dark:text-fog dark:hover:bg-edge/40 md:hidden"
                  aria-label="Đóng thanh bên"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mx-4 mb-2">
              <div className="h-px bg-slate-200 dark:bg-line/60" />
            </div>

            {/* Recent Chats List */}
            <div className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-4">
              <div className="px-2.5 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-fog/50">
                Gần đây
              </div>
              {threads.map((item) => {
                const active = item.id === activeThreadId;
                return (
                  <div
                    key={item.id}
                    className={`group/item flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all ${
                      active
                        ? 'shadow-sm border-slate-200 bg-slate-100 text-slate-900 dark:border-line dark:bg-edge/80 dark:text-white'
                        : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-gray-300 dark:hover:bg-edge/40'
                    }`}
                  >
                    {onSelectChat ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelectChat(item.id)}
                        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MessageSquare
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            active
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-fog/50'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{item.title}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-fog/60">
                            {item.time}
                          </div>
                        </div>
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <MessageSquare
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            active
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-fog/50'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{item.title}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-fog/60">
                            {item.time}
                          </div>
                        </div>
                      </div>
                    )}

                    {onDeleteChat && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteChat(item.id);
                        }}
                        className="ml-1 shrink-0 cursor-pointer rounded-lg p-1 text-slate-400 opacity-0 transition-all hover:bg-slate-200 hover:text-rose-500 group-hover/item:opacity-100 disabled:invisible dark:text-fog/50 dark:hover:bg-edge dark:hover:text-rose-400"
                        title="Xóa cuộc trò chuyện"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* User Profile */}
            <div className="shrink-0 border-t border-slate-200 p-3 dark:border-line/50">
              <div className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-edge/40">
                <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-line dark:bg-edge">
                  <Image
                    src="/user-avatar.png"
                    alt={userName}
                    width={32}
                    height={32}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                    {userName}
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-500 dark:text-fog/60">
                    Khám phá hướng nghiệp
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
