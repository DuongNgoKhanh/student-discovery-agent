'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { ChevronsRight, MessageSquare, Plus, Trash2, X } from 'lucide-react';

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
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-200 md:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm transition-[width,transform] duration-300 ease-out dark:border-white/5 dark:bg-panel md:static ${
          isMobileSidebarOpen
            ? 'm-3 h-[calc(100%-1.5rem)] w-[288px] translate-x-0 shadow-2xl md:m-0 md:h-full'
            : `invisible -translate-x-full md:visible md:translate-x-0 ${isDesktopSidebarOpen ? 'md:w-[288px]' : 'md:w-[68px]'}`
        }`}
      >
        {!isExpanded ? (
          /* Collapsed Desktop Sidebar */
          <div className="flex h-full flex-col items-center gap-3 py-4">
            <BrandMark />

            <button
              type="button"
              onClick={onToggleDesktopSidebar}
              className={ICON_BUTTON_CLASS}
              title="Mở sidebar"
              aria-label="Mở sidebar"
            >
              <ChevronsRight className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="h-px w-8 bg-border dark:bg-white/10" />

            <button
              type="button"
              disabled={disabled}
              onClick={onNewChat}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              title="Cuộc trò chuyện mới"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="no-scrollbar mt-1 flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto">
              {threads.map((item) => {
                const active = item.id === activeThreadId;
                const stateClass = active
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/5';
                if (!onSelectChat) {
                  return (
                    <div
                      key={item.id}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${stateClass}`}
                      title={item.title}
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    </div>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectChat(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${stateClass}`}
                    title={item.title}
                  >
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <div className="mt-auto flex w-full flex-col items-center border-t border-border pt-3 dark:border-white/5">
              <UserAvatar name={userName} />
            </div>
          </div>
        ) : (
          /* Expanded Sidebar */
          <>
            {/* Brand Logo */}
            <div className="flex items-center gap-3 px-4 pb-3 pt-4">
              <BrandMark />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[15px] font-semibold tracking-tight text-foreground">IHRD</div>
                <div className="truncate text-xs text-muted-foreground">Khám phá hướng nghiệp</div>
              </div>
              {isMobileSidebarOpen && (
                <button
                  type="button"
                  onClick={onCloseMobileSidebar}
                  className={`${ICON_BUTTON_CLASS} md:hidden`}
                  aria-label="Đóng thanh bên"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* New Chat Button */}
            <div className="shrink-0 px-3 pb-3">
              <button
                type="button"
                disabled={disabled}
                onClick={onNewChat}
                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Cuộc trò chuyện mới
              </button>
            </div>

            {/* Recent Chats List */}
            <nav aria-label="Cuộc trò chuyện gần đây" className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
              <div className="px-2 pb-2 pt-3 text-xs font-medium text-muted-foreground">Gần đây</div>
              <div className="space-y-0.5">
                {threads.map((item) => {
                  const active = item.id === activeThreadId;
                  const content = (
                    <>
                      <MessageSquare
                        className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{item.time}</div>
                      </div>
                    </>
                  );
                  return (
                    <div
                      key={item.id}
                      className={`group/item relative flex items-center rounded-xl px-2.5 py-2 transition-colors ${
                        active
                          ? 'bg-primary-subtle text-foreground'
                          : 'text-foreground/80 hover:bg-muted dark:hover:bg-white/5'
                      }`}
                    >
                      {active && (
                        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                      )}
                      {onSelectChat ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onSelectChat(item.id)}
                          aria-current={active ? 'page' : undefined}
                          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-start gap-3 text-left">{content}</div>
                      )}

                      {onDeleteChat && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChat(item.id);
                          }}
                          className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[opacity,color,background-color] hover:bg-destructive-subtle hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:invisible md:opacity-0 md:group-hover/item:opacity-100"
                          title="Xóa cuộc trò chuyện"
                          aria-label="Xóa cuộc trò chuyện"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </nav>

            {/* User Profile */}
            <div className="shrink-0 border-t border-border p-3 dark:border-white/5">
              <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                <UserAvatar name={userName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{userName}</div>
                  <div className="truncate text-xs text-muted-foreground">Khám phá hướng nghiệp</div>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

const ICON_BUTTON_CLASS =
  'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5';

function BrandMark() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-border dark:ring-white/10">
      <Image src="/Logo-IHRD.png" alt="IHRD Logo" width={36} height={36} className="h-full w-full object-contain" />
    </div>
  );
}

function UserAvatar({ name }: { name: string }) {
  return (
    <div
      className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border dark:ring-white/10"
      title={name}
    >
      <Image src="/user-avatar.png" alt={name} width={32} height={32} className="h-full w-full object-cover" />
    </div>
  );
}
