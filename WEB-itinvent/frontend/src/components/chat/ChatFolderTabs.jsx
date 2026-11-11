import { memo, useEffect, useRef } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';

import { DEFAULT_CHAT_FOLDER_KEY, buildChatFolderTabList } from './chatFolderUtils';

function FolderTab({
  label,
  active,
  unreadCount = 0,
  onClick,
  reducedMotion = false,
  compact = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-1.5 pt-1 transition-colors duration-150 active:opacity-80 hover:text-[color:var(--chat-text-primary)] ${compact ? 'px-2' : 'px-3'}`}
      style={{
        // Д2: вкладки папок как в Telegram Web A — текст 15px/500 без заливки,
        // активная — акцентная с полосой 3px снизу.
        color: active ? 'var(--chat-folder-tab-active-text)' : 'var(--chat-text-secondary)',
        backgroundColor: 'transparent',
        fontSize: compact ? 14 : 15,
        fontWeight: 500,
        lineHeight: '20px',
      }}
    >
      <span className="relative z-[1]">{label}</span>
      {unreadCount > 0 ? (
        <span
          data-chat-folder-unread-badge="true"
          aria-label={`Непрочитанных сообщений: ${unreadCount}`}
          className="relative z-[1] inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none"
          style={{
            minWidth: 18,
            height: 18,
            backgroundColor: active ? 'var(--chat-folder-tab-active-badge-bg)' : 'var(--chat-unread-bg)',
            color: active ? 'var(--chat-folder-tab-active-badge-text)' : 'var(--chat-unread-text)',
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
      {active ? (
        <motion.span
          layoutId="chat-folder-active-underline"
          data-testid="chat-folder-tab-underline"
          className="chat-folder-tab-underline absolute inset-x-1 bottom-0 rounded-full"
          style={{ height: 3, backgroundColor: 'var(--chat-folder-tab-active-bg)' }}
          transition={reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 520, damping: 36, mass: 0.75 }}
        />
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
  includeAllTab = false,
  compact = false,
}) {
  const scrollRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = disableMotion || prefersReducedMotion;
  const tabs = buildChatFolderTabList(customFolders, { includeAllTab });
  const normalizedActiveKey = String(activeFolderKey || DEFAULT_CHAT_FOLDER_KEY).trim() || DEFAULT_CHAT_FOLDER_KEY;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeButton = container.querySelector('[data-folder-tab-active="true"]');
    if (!activeButton || typeof activeButton.scrollIntoView !== 'function') return;
    activeButton.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [normalizedActiveKey, reducedMotion, tabs.length]);

  return (
    <div className="chat-scroll-hidden -mx-1 overflow-x-auto px-1 pb-0.5 pt-0.5">
      <LayoutGroup id="chat-folder-tabs">
        <div ref={scrollRef} className={`flex min-w-max items-center pr-2 ${compact ? 'gap-1' : 'gap-3'}`}>
          {tabs.map((tab) => {
            const active = normalizedActiveKey === tab.key;
            return (
              <div key={tab.key} data-folder-tab-active={active ? 'true' : 'false'}>
                <FolderTab
                  compact={compact}
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
