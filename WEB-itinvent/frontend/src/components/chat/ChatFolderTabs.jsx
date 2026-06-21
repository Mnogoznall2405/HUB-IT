import { memo, useEffect, useRef } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';

import { buildChatFolderTabList } from './chatFolderUtils';

function FolderTab({
  label,
  active,
  unreadCount = 0,
  onClick,
  reducedMotion = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors duration-150 active:opacity-80"
      style={{
        color: active ? 'var(--chat-folder-tab-active-text)' : 'var(--chat-text-secondary)',
        fontSize: 15,
        fontWeight: active ? 600 : 500,
        lineHeight: '20px',
      }}
    >
      {active ? (
        <motion.span
          layoutId="chat-folder-active-pill"
          className="chat-folder-tab-shimmer absolute inset-0 rounded-full"
          style={{ backgroundColor: 'var(--chat-folder-tab-active-bg)' }}
          transition={reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 520, damping: 36, mass: 0.75 }}
        />
      ) : null}
      <span className="relative z-[1]">{label}</span>
      {unreadCount > 0 ? (
        <span
          className="relative z-[1] inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none"
          style={{
            height: 18,
            backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'var(--chat-unread-bg)',
            color: active ? '#ffffff' : 'var(--chat-unread-text)',
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </button>
  );
}

function ChatFolderTabs({
  activeFolderKey,
  customFolders = [],
  folderUnreadCounts = {},
  onFolderChange,
  disableMotion = false,
}) {
  const scrollRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = disableMotion || prefersReducedMotion;
  const tabs = buildChatFolderTabList(customFolders);
  const normalizedActiveKey = String(activeFolderKey || 'all').trim() || 'all';

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeButton = container.querySelector('[data-folder-tab-active="true"]');
    if (!activeButton || typeof activeButton.scrollIntoView !== 'function') return;
    activeButton.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [normalizedActiveKey, reducedMotion, tabs.length]);

  return (
    <div className="chat-scroll-hidden -mx-1 overflow-x-auto px-1 pb-1 pt-0.5">
      <LayoutGroup id="chat-folder-tabs">
        <div ref={scrollRef} className="flex min-w-max items-center gap-4 pr-2">
          {tabs.map((tab) => {
            const active = normalizedActiveKey === tab.key;
            return (
              <div key={tab.key} data-folder-tab-active={active ? 'true' : 'false'}>
                <FolderTab
                  label={tab.label}
                  active={active}
                  unreadCount={Number(folderUnreadCounts?.[tab.key] || 0)}
                  onClick={() => onFolderChange?.(tab.key)}
                  reducedMotion={reducedMotion}
                />
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}

export default memo(ChatFolderTabs);
