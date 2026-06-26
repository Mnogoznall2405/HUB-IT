import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Checkbox, CircularProgress, Divider, Menu, MenuItem, Skeleton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ExitToAppRoundedIcon from '@mui/icons-material/ExitToAppRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';

import { AiConversationAvatar, ConversationAvatar, PresenceAvatar } from './ChatCommon';
import ChatFolderTabs from './ChatFolderTabs';
import { getConversationFolderIds, shouldShowAiChatSection } from './chatFolderUtils';
import { useChatFolderSwipe } from './useChatFolderSwipe';
import {
  formatShortTime,
  getConversationDisplayTitle,
  getConversationStatusLine,
  getPersonStatusLine,
  getStatusMeta,
  getTaskConversationMetaLine,
  isCompletedTaskConversation,
  isTaskConversation,
} from './chatHelpers';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';

export const CHAT_SIDEBAR_ROW_USES_LAYOUT_ANIMATION = false;

export const getChatFolderPanelMotionProps = (reducedMotion = false, direction = 0) => {
  if (reducedMotion || !direction) {
    return {
      initial: reducedMotion ? false : { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      exit: reducedMotion ? undefined : { opacity: 0, y: -8 },
      transition: { duration: reducedMotion ? 0 : 0.24, ease: 'easeOut' },
    };
  }

  const enterX = direction > 0 ? -24 : 24;
  const exitX = direction > 0 ? 24 : -24;
  return {
    initial: { opacity: 0, x: enterX },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: exitX },
    transition: { duration: 0.24, ease: 'easeOut' },
  };
};

const joinClasses = (...values) => values.filter(Boolean).join(' ');
const FALLBACK_DENSITY = {
  touchTarget: 44,
  sidebarAvatar: 52,
  sidebarAvatarMobile: 54,
  sidebarActionButton: 36,
  sidebarActionButtonMobile: 44,
  sidebarHeaderIcon: 42,
  sidebarSearchHeight: 48,
  sidebarSearchFontSize: '16px',
  sidebarRowMinHeight: 66,
  sidebarRowPx: 12,
  sidebarRowPy: 10,
  sidebarRowMx: 6,
  sidebarRowMy: 2,
  sidebarRowRadius: 12,
  sidebarResultRowPx: 14,
  sidebarResultRowPy: 12,
  sidebarTitleFontSize: '15px',
  sidebarResultTitleFontSize: '16px',
  sidebarPreviewFontSize: '12.5px',
  sidebarSectionFontSize: '11px',
};
const getDensity = (ui) => ui?.density || FALLBACK_DENSITY;
const getSidebarAvatarSize = (density, compactMobile = false) => (
  compactMobile ? (density.sidebarAvatarMobile || 54) : (density.sidebarAvatar || 52)
);
const getSidebarRowStyle = (density, compactMobile = false) => {
  if (compactMobile) return {};
  return {
    minHeight: density.sidebarRowMinHeight,
    padding: `${density.sidebarRowPy}px ${density.sidebarRowPx}px`,
    margin: `${density.sidebarRowMy}px ${density.sidebarRowMx}px`,
    borderRadius: density.sidebarRowRadius,
  };
};

function SidebarSkeletonRow({ ui, compactMobile = false, align = 'left' }) {
  const density = getDensity(ui);
  const avatarSize = getSidebarAvatarSize(density, compactMobile);
  return (
    <div
      className={joinClasses(
        'flex items-center gap-2.5',
        compactMobile ? 'border-b px-3 py-2.5' : 'mx-1.5 my-0.5 rounded-[12px] px-3 py-2.5',
      )}
      style={{ borderColor: 'var(--chat-sidebar-divider)', ...getSidebarRowStyle(density, compactMobile) }}
    >
      <Skeleton
        variant="circular"
        width={avatarSize}
        height={avatarSize}
        animation="wave"
        sx={{
          bgcolor: 'var(--chat-skeleton-base)',
          '&::after': { background: 'linear-gradient(90deg, transparent, var(--chat-skeleton-wave), transparent)' },
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-3">
          <Skeleton
            variant="rounded"
            width={align === 'left' ? '58%' : '46%'}
            height={15}
            animation="wave"
            sx={{ borderRadius: 999, bgcolor: 'var(--chat-skeleton-base)' }}
          />
          <Skeleton
            variant="rounded"
            width={38}
            height={11}
            animation="wave"
            sx={{ borderRadius: 999, bgcolor: 'var(--chat-skeleton-base)' }}
          />
        </div>
        <Skeleton
          variant="rounded"
          width={align === 'left' ? '78%' : '64%'}
          height={12}
          animation="wave"
          sx={{ mt: 1.1, borderRadius: 999, bgcolor: 'var(--chat-skeleton-base)' }}
        />
      </div>
    </div>
  );
}

function SidebarLoadingSkeleton({ ui, compactMobile = false }) {
  return (
    <div className={compactMobile ? 'pt-1' : 'pt-2'}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <SidebarSkeletonRow key={index} ui={ui} compactMobile={compactMobile} align={index % 2 ? 'right' : 'left'} />
      ))}
    </div>
  );
}

function SearchSectionHeader({ children, ui, compactMobile = false }) {
  const density = getDensity(ui);
  return (
    <div className={joinClasses(
      'px-3 font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-sidebar-section-label)]',
      compactMobile ? 'pb-1 pt-3 text-[10px]' : 'pb-1.5 pt-4 text-[11px]',
    )}
    style={compactMobile ? undefined : { fontSize: density.sidebarSectionFontSize }}
    >
      {children}
    </div>
  );
}

function TaskSectionHeader({
  label,
  count,
  unreadCount,
  expanded = true,
  collapsible = false,
  onToggle,
  compactMobile = false,
}) {
  const content = (
    <>
      <span>{label}</span>
      <span className="ml-1 text-[color:var(--chat-text-secondary)]">{count}</span>
      {unreadCount > 0 ? (
        <span
          className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
          style={{
            height: 18,
            backgroundColor: 'var(--chat-unread-bg)',
            color: 'var(--chat-unread-text)',
          }}
        >
          {unreadCount}
        </span>
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <div
        data-testid={`task-section-${label === 'Активные' ? 'active' : 'completed'}`}
        className={joinClasses(
          'flex items-center px-3 font-semibold uppercase tracking-[0.1em] text-[color:var(--chat-sidebar-section-label)]',
          compactMobile ? 'pb-1 pt-3 text-[10px]' : 'pb-1 pt-3.5 text-[11px]',
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="task-section-completed-toggle"
      aria-expanded={expanded}
      onClick={onToggle}
      className={joinClasses(
        'flex w-full items-center px-3 text-left font-semibold uppercase tracking-[0.1em] text-[color:var(--chat-sidebar-section-label)]',
        compactMobile ? 'pb-1 pt-3 text-[10px]' : 'pb-1 pt-3.5 text-[11px]',
      )}
    >
      {content}
      <KeyboardArrowDownRoundedIcon
        sx={{
          ml: 'auto',
          fontSize: 18,
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 140ms ease',
        }}
      />
    </button>
  );
}

function SidebarActionButton({
  title,
  children,
  onClick,
  disabled = false,
  compactMobile = false,
  className = '',
  ui,
}) {
  const density = getDensity(ui);
  const size = compactMobile
    ? (density.sidebarActionButtonMobile || density.touchTarget || 44)
    : (density.sidebarActionButton || 36);
  return (
    <Tooltip title={title}>
      <span>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={title}
          className={joinClasses(
            'inline-flex items-center justify-center rounded-full text-[color:var(--chat-sidebar-action-text)] transition duration-100 active:scale-[0.96] active:opacity-60 disabled:cursor-not-allowed disabled:opacity-40',
            compactMobile ? 'h-10 w-10' : 'h-9 w-9',
            className,
          )}
          style={{ width: size, height: size, minWidth: size, backgroundColor: 'var(--chat-header-action-bg)' }}
        >
          {children}
        </button>
      </span>
    </Tooltip>
  );
}

function ConversationRow({
  item,
  theme,
  ui,
  activeConversationId,
  onOpenConversation,
  onPrefetchConversation,
  onOpenFolderMenu,
  draftPreview,
  compactMobile = false,
  index = 0,
  reducedMotion = false,
}) {
  const density = getDensity(ui);
  const longPressTimerRef = useRef(null);
  const unreadCount = Number(item?.unread_count || 0);
  const active = item.id === activeConversationId;
  const taskConversation = isTaskConversation(item);
  const taskTitle = getConversationDisplayTitle(item);
  const taskMetaLine = getTaskConversationMetaLine(item);
  const [taskStatusLabel, taskStatusColor, taskStatusBg] = getStatusMeta(item?.task_status);
  const previewText = draftPreview || (item?.kind === 'ai'
    ? `AI • ${String(item?.last_message_preview || '').trim() || 'Готов к диалогу'}`
    : getConversationStatusLine(item));
  const taskPreviewText = draftPreview
    ? `Черновик: ${draftPreview}`
    : (String(item?.last_message_preview || '').trim() || 'Сообщений пока нет');

  const rowIndicators = (
    <>
      {!compactMobile && item.is_pinned ? <PushPinOutlinedIcon sx={{ fontSize: 15, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}
      {!compactMobile && item.is_muted ? <NotificationsOffOutlinedIcon sx={{ fontSize: 15, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}
      {!compactMobile && item.is_archived ? <ArchiveOutlinedIcon sx={{ fontSize: 15, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}

      {unreadCount > 0 ? (
        <span
          className="inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
          style={{
            backgroundColor: active ? 'rgba(255,255,255,0.16)' : 'var(--chat-unread-bg)',
            color: active ? '#ffffff' : 'var(--chat-unread-text)',
            height: unreadCount > 9 ? 20 : 18,
            boxShadow: active ? 'none' : '0 1px 4px rgba(51,144,236,0.25)',
          }}
        >
          {unreadCount}
        </span>
      ) : null}
    </>
  );

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleOpenFolderMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFolderMenu?.(item, event);
  };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.18, delay: Math.min(index, 7) * 0.02 }}
    >
      <button
        type="button"
        onClick={() => onOpenConversation(item.id)}
        onContextMenu={handleOpenFolderMenu}
        onPointerDown={() => onPrefetchConversation?.(item.id)}
        onTouchStart={(event) => {
          onPrefetchConversation?.(item.id);
          clearLongPress();
          const touch = event.touches?.[0];
          const menuPoint = {
            clientX: Number(touch?.clientX || 0),
            clientY: Number(touch?.clientY || 0),
          };
          longPressTimerRef.current = window.setTimeout(() => {
            onOpenFolderMenu?.(item, menuPoint);
          }, 520);
        }}
        onTouchEnd={clearLongPress}
        onTouchMove={clearLongPress}
        aria-current={active ? 'page' : undefined}
        data-chat-active={active ? 'true' : 'false'}
        className={joinClasses(
          'relative w-full overflow-hidden text-left transition duration-100 active:scale-[0.995] active:opacity-90',
          compactMobile
            ? 'border-b px-3 py-2.5'
            : 'mx-1.5 my-0.5 rounded-[12px] border px-3 py-2.5',
          active
            ? ''
            : 'text-[color:var(--chat-text-primary)] hover:bg-[var(--chat-sidebar-row-hover)]',
        )}
        style={{
          ...getSidebarRowStyle(density, compactMobile),
          backgroundColor: active ? 'var(--chat-sidebar-row-active)' : 'transparent',
          color: active ? 'var(--chat-text-on-accent)' : 'var(--chat-text-primary)',
          borderColor: compactMobile ? 'var(--chat-sidebar-divider)' : (active ? alpha(theme.palette.primary.main, 0.18) : 'transparent'),
          boxShadow: active
            ? (
              theme.palette.mode === 'dark'
                ? 'inset 3px 0 0 rgba(125,211,252,0.9), 0 10px 24px rgba(8,19,32,0.22)'
                : '0 12px 30px rgba(51,144,236,0.24), inset 0 0 0 1px rgba(255,255,255,0.12)'
            )
            : 'none',
          outline: 'none',
        }}
      >
        <div className="flex items-center gap-2.5">
          <ConversationAvatar
            conversation={item}
            online={Boolean(item?.kind === 'direct' && item?.direct_peer?.presence?.is_online)}
            size={getSidebarAvatarSize(density, compactMobile)}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className={joinClasses(
                  'min-w-0 truncate leading-[1.15] tracking-[-0.01em]',
                  compactMobile ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold',
                )}
                style={compactMobile ? undefined : { fontSize: density.sidebarTitleFontSize }}
                >
                  {taskConversation ? taskTitle : item.title}
                </p>
                {taskConversation ? (
                  <span
                    data-testid={`task-chat-status-${item.id}`}
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                    style={{
                      color: active ? '#ffffff' : taskStatusColor,
                      backgroundColor: active ? 'rgba(255,255,255,0.16)' : taskStatusBg,
                    }}
                  >
                    {taskStatusLabel}
                  </span>
                ) : null}
              </div>
              <span className={joinClasses(
                'shrink-0 pt-0.5 text-right',
                compactMobile ? 'text-[12px]' : 'text-[12px]',
                active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]',
              )}
              >
                {formatShortTime(item.last_message_at || item.updated_at)}
              </span>
            </div>

            {taskConversation ? (
              <>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <p
                    data-testid={`task-chat-meta-${item.id}`}
                    className={joinClasses(
                      'min-w-0 flex-1 truncate',
                      compactMobile ? 'text-[13px] leading-[1.3]' : 'text-[12px] leading-[1.3]',
                      active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]',
                    )}
                  >
                    {taskMetaLine}{compactMobile && draftPreview ? ' • Черновик' : ''}
                  </p>
                  {rowIndicators}
                </div>
                {!compactMobile ? (
                  <p
                    data-testid={`task-chat-preview-${item.id}`}
                    className={joinClasses(
                      'mt-0.5 truncate text-[12px] leading-[1.25]',
                      draftPreview
                        ? (active ? 'font-semibold text-[color:var(--chat-row-active-subtle)]' : 'font-semibold text-[color:var(--chat-draft-text)]')
                        : (active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]'),
                    )}
                  >
                    {taskPreviewText}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="mt-0.5 flex items-center gap-1.5">
                <p className={joinClasses(
                  'min-w-0 flex-1 truncate',
                  compactMobile ? 'text-[13px] leading-[1.3]' : 'text-[12.5px] leading-[1.3]',
                  draftPreview
                    ? (active ? 'font-semibold text-[color:var(--chat-row-active-subtle)]' : 'font-semibold text-[color:var(--chat-draft-text)]')
                    : (active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]'),
                )}
                style={compactMobile ? undefined : { fontSize: density.sidebarPreviewFontSize }}
                >
                  {draftPreview ? `Черновик: ${draftPreview}` : previewText}
                </p>
                {rowIndicators}
              </div>
            )}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function PersonSearchRow({ person, openingPeerId, onOpenPeer, compactMobile = false, ui }) {
  const opening = openingPeerId === String(person.id);
  const density = getDensity(ui);

  return (
    <button
      type="button"
      onClick={() => void onOpenPeer(person)}
      disabled={opening}
      className={joinClasses(
        'flex w-full items-center gap-3 text-left transition duration-100 active:opacity-90 disabled:opacity-60',
        compactMobile
          ? 'border-b border-[color:var(--chat-sidebar-divider)] px-3 py-3'
          : 'mx-2 my-1 rounded-[14px] border border-transparent px-3.5 py-3 hover:bg-[var(--chat-sidebar-row-hover)]',
      )}
      style={compactMobile ? undefined : {
        minHeight: density.sidebarRowMinHeight,
        padding: `${density.sidebarResultRowPy}px ${density.sidebarResultRowPx}px`,
      }}
    >
      <PresenceAvatar item={person} online={Boolean(person?.presence?.is_online)} size={compactMobile ? 54 : density.sidebarAvatar} />
      <div className="min-w-0 flex-1">
        <p
          className={joinClasses('truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-primary)]', compactMobile ? 'text-[17px]' : 'text-[16px]')}
          style={compactMobile ? undefined : { fontSize: density.sidebarResultTitleFontSize }}
        >
          {person.full_name || person.username}
        </p>
        <p
          className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[14px]' : 'text-[13px]')}
          style={compactMobile ? undefined : { fontSize: density.sidebarPreviewFontSize }}
        >
          {getPersonStatusLine(person)}
        </p>
      </div>
      {opening ? <CircularProgress size={18} /> : null}
    </button>
  );
}

function AiBotRow({ bot, openingAiBotId, onOpenAiBot, compactMobile = false, ui }) {
  const opening = String(openingAiBotId || '').trim() === String(bot?.id || '').trim();
  const density = getDensity(ui);
  return (
    <button
      type="button"
      onClick={() => void onOpenAiBot?.(bot)}
      disabled={opening}
      className={joinClasses(
        'flex w-full items-center gap-3 text-left transition duration-100 active:opacity-90 disabled:opacity-60',
        compactMobile
          ? 'border-b border-[color:var(--chat-sidebar-divider)] px-3 py-3'
          : 'mx-2 my-1 rounded-[14px] border border-transparent px-3.5 py-3 hover:bg-[var(--chat-sidebar-row-hover)]',
      )}
      style={compactMobile ? undefined : {
        minHeight: density.sidebarRowMinHeight,
        padding: `${density.sidebarResultRowPy}px ${density.sidebarResultRowPx}px`,
      }}
    >
      <AiConversationAvatar size={compactMobile ? 54 : density.sidebarAvatar} />
      <div className="min-w-0 flex-1">
        <p
          className={joinClasses('truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-primary)]', compactMobile ? 'text-[17px]' : 'text-[16px]')}
          style={compactMobile ? undefined : { fontSize: density.sidebarResultTitleFontSize }}
        >
          {bot?.title || 'AI'}
        </p>
        <p
          className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[14px]' : 'text-[13px]')}
          style={compactMobile ? undefined : { fontSize: density.sidebarPreviewFontSize }}
        >
          {String(bot?.description || '').trim() || 'Корпоративный AI-ассистент'}
        </p>
      </div>
      {opening ? <CircularProgress size={18} /> : <SmartToyOutlinedIcon sx={{ color: 'var(--chat-text-secondary)' }} />}
    </button>
  );
}

function AiConversationRow({
  bot,
  theme,
  ui,
  activeConversationId,
  onOpenConversation,
  onPrefetchConversation,
  openingAiBotId,
  onOpenAiBot,
  onOpenConversationMenu,
  compactMobile = false,
  index = 0,
  reducedMotion = false,
}) {
  const density = getDensity(ui);
  const opening = String(openingAiBotId || '').trim() === String(bot?.id || '').trim();
  const conversationId = String(bot?.conversation_id || '').trim();
  const active = Boolean(conversationId && conversationId === String(activeConversationId || '').trim());
  const unreadCount = Number(bot?.unread_count || 0);
  const draftPreview = String(bot?.draft_preview || '').trim();
  const previewText = draftPreview
    ? `Черновик: ${draftPreview}`
    : (String(bot?.last_message_preview || '').trim() || String(bot?.description || '').trim() || 'Корпоративный AI-ассистент');

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.18, delay: Math.min(index, 7) * 0.02 }}
    >
      <button
        type="button"
        onClick={() => {
          if (conversationId) {
            onOpenConversation?.(conversationId);
            return;
          }
          void onOpenAiBot?.(bot);
        }}
        onPointerDown={() => {
          if (conversationId) onPrefetchConversation?.(conversationId);
        }}
        onContextMenu={(event) => {
          if (!conversationId) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenConversationMenu?.({
            ...bot,
            id: conversationId,
            kind: 'ai',
            title: bot?.title || 'AI',
          }, event);
        }}
        onTouchStart={() => {
          if (conversationId) onPrefetchConversation?.(conversationId);
        }}
        disabled={opening}
        aria-current={active ? 'page' : undefined}
        data-chat-active={active ? 'true' : 'false'}
        className={joinClasses(
          'relative w-full overflow-hidden text-left transition duration-100 active:scale-[0.995] active:opacity-90 disabled:opacity-60',
          compactMobile
            ? 'border-b px-3 py-2.5'
            : 'mx-1.5 my-0.5 rounded-[12px] border px-3 py-2.5',
          active
            ? ''
            : 'text-[color:var(--chat-text-primary)] hover:bg-[var(--chat-sidebar-row-hover)]',
        )}
        style={{
          ...getSidebarRowStyle(density, compactMobile),
          backgroundColor: active ? 'var(--chat-sidebar-row-active)' : 'transparent',
          color: active ? 'var(--chat-text-on-accent)' : 'var(--chat-text-primary)',
          borderColor: compactMobile ? 'var(--chat-sidebar-divider)' : (active ? alpha(theme.palette.primary.main, 0.18) : 'transparent'),
          boxShadow: active
            ? (
              theme.palette.mode === 'dark'
                ? 'inset 3px 0 0 rgba(125,211,252,0.9), 0 10px 24px rgba(8,19,32,0.24)'
                : '0 12px 30px rgba(51,144,236,0.24), inset 0 0 0 1px rgba(255,255,255,0.12)'
            )
            : 'none',
        }}
      >
        <div className="flex items-center gap-2.5">
          <AiConversationAvatar size={getSidebarAvatarSize(density, compactMobile)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className={joinClasses(
                'truncate leading-[1.15] tracking-[-0.01em]',
                compactMobile ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold',
              )}
              style={compactMobile ? undefined : { fontSize: density.sidebarTitleFontSize }}
              >
                {bot?.title || 'AI'}
              </p>
              <span className={joinClasses(
                'shrink-0 pt-0.5 text-right',
                compactMobile ? 'text-[12px]' : 'text-[12px]',
                active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]',
              )}
              >
                {formatShortTime(bot?.last_message_at || bot?.updated_at)}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-1.5">
              <p className={joinClasses(
                'min-w-0 flex-1 truncate',
                compactMobile ? 'text-[13px] leading-[1.3]' : 'text-[12.5px] leading-[1.3]',
                draftPreview
                  ? (active ? 'font-semibold text-[color:var(--chat-row-active-subtle)]' : 'font-semibold text-[color:var(--chat-draft-text)]')
                  : (active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]'),
              )}
              style={compactMobile ? undefined : { fontSize: density.sidebarPreviewFontSize }}
              >
                {previewText}
              </p>

              {opening ? <CircularProgress size={16} /> : null}
              {!opening && !compactMobile && bot?.is_pinned ? <PushPinOutlinedIcon sx={{ fontSize: 15, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}
              {!opening && !compactMobile && bot?.is_muted ? <NotificationsOffOutlinedIcon sx={{ fontSize: 15, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}
              {!opening && unreadCount <= 0 && !conversationId ? <SmartToyOutlinedIcon sx={{ fontSize: 16, color: active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)' }} /> : null}
              {unreadCount > 0 ? (
                <span
                  className="inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.16)' : 'var(--chat-unread-bg)',
                    color: active ? '#ffffff' : 'var(--chat-unread-text)',
                    height: unreadCount > 9 ? 20 : 18,
                    boxShadow: active ? 'none' : '0 1px 4px rgba(51,144,236,0.25)',
                  }}
                >
                  {unreadCount}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function InfoCard({ children, compactMobile = false }) {
  return (
    <div
      className={joinClasses(
        'rounded-[14px] border text-[color:var(--chat-info-card-text)]',
        compactMobile ? 'mx-2 mt-2 px-3 py-3 text-[13px]' : 'mx-3 mt-3 px-4 py-3 text-[13px]',
      )}
      style={{
        borderColor: 'var(--chat-info-card-border)',
        backgroundColor: 'var(--chat-info-card-bg)',
      }}
    >
      {children}
    </div>
  );
}

function ChatSidebar({
  theme,
  ui,
  isMobile,
  compactMobile = false,
  disableMotion = false,
  health,
  user,
  unreadTotal,
  sidebarQuery,
  onSidebarQueryChange,
  sidebarSearchActive,
  searchingSidebar,
  searchPeople,
  searchChats,
  searchResultEmpty,
  openingPeerId,
  onOpenPeer,
  activeConversationId,
  onOpenConversation,
  onPrefetchConversation,
  conversationsLoading,
  conversations,
  onOpenGroup,
  sidebarScrollRef,
  activeFolderKey = 'all',
  onActiveFolderChange,
  customFolders = [],
  folderUnreadCounts = {},
  conversationIdsByFolder = {},
  onOpenFolderManager,
  onOpenArchive,
  onToggleConversationInFolder,
  onUpdateConversationSettings,
  onRequestDeleteConversation,
  onRequestLeaveConversation,
  conversationActionPendingId = '',
  draftsByConversation,
  aiBots = [],
  aiBotsLoading = false,
  aiBotsError = '',
  showAiSection: showAiSectionEnabled = false,
  onOpenAiBot,
  openingAiBotId = '',
}) {
  const density = getDensity(ui);
  const { openDrawer, headerMode } = useMainLayoutShell();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = disableMotion || prefersReducedMotion;
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);
  const [folderMenuConversation, setFolderMenuConversation] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [completedTasksOpen, setCompletedTasksOpen] = useState(true);
  const showEmbeddedMenuButton = false;
  const chatUnavailable = health?.available === false;
  const showAiSection = showAiSectionEnabled
    && shouldShowAiChatSection(activeFolderKey)
    && String(activeFolderKey || '') !== 'archived'
    && !sidebarSearchActive;
  const folderMenuConversationId = String(folderMenuConversation?.id || '').trim();
  const selectedFolderIds = useMemo(
    () => new Set(getConversationFolderIds(folderMenuConversationId, conversationIdsByFolder)),
    [conversationIdsByFolder, folderMenuConversationId],
  );
  const {
    folderSwipeOffset,
    folderSwipeDirection,
    setScrollElement,
    shouldSuppressListClick,
  } = useChatFolderSwipe({
    enabled: isMobile && !sidebarSearchActive,
    activeFolderKey,
    customFolders,
    onFolderChange: onActiveFolderChange,
  });
  const folderPanelMotion = getChatFolderPanelMotionProps(reducedMotion, folderSwipeDirection);
  const handleOpenConversation = useCallback((conversationId) => {
    if (shouldSuppressListClick()) return;
    onOpenConversation?.(conversationId);
  }, [onOpenConversation, shouldSuppressListClick]);
  const handleSidebarScrollRef = useCallback((node) => {
    setScrollElement(node);
    if (!sidebarScrollRef) return;
    if (typeof sidebarScrollRef === 'function') sidebarScrollRef(node);
    else sidebarScrollRef.current = node;
  }, [setScrollElement, sidebarScrollRef]);
  const taskSections = useMemo(() => {
    if (String(activeFolderKey || '').trim() !== 'tasks') return null;
    const active = [];
    const completed = [];
    (Array.isArray(conversations) ? conversations : []).forEach((conversation) => {
      if (isCompletedTaskConversation(conversation)) completed.push(conversation);
      else active.push(conversation);
    });
    const summarize = (items) => ({
      items,
      unreadCount: items.reduce((sum, item) => sum + Number(item?.unread_count || 0), 0),
    });
    return {
      active: summarize(active),
      completed: summarize(completed),
    };
  }, [activeFolderKey, conversations]);

  const handleOpenFolderMenu = (conversation, event) => {
    setFolderMenuConversation(conversation);
    const fallbackRect = event?.currentTarget?.getBoundingClientRect?.();
    setFolderMenuPosition({
      top: Math.round(Number(event?.clientY || fallbackRect?.bottom || 0)),
      left: Math.round(Number(event?.clientX || fallbackRect?.left || 0)),
    });
  };

  const handleCloseFolderMenu = () => {
    setFolderMenuPosition(null);
    setFolderMenuConversation(null);
  };
  const runConversationSetting = (payload) => {
    const conversationId = folderMenuConversationId;
    handleCloseFolderMenu();
    if (!conversationId) return;
    void onUpdateConversationSettings?.(conversationId, payload);
  };
  const requestConversationDelete = () => {
    const conversation = folderMenuConversation;
    handleCloseFolderMenu();
    if (conversation) onRequestDeleteConversation?.(conversation);
  };
  const requestConversationLeave = () => {
    const conversation = folderMenuConversation;
    handleCloseFolderMenu();
    if (conversation) onRequestLeaveConversation?.(conversation);
  };
  const aiSection = showAiSection ? (
    <>
      <SearchSectionHeader ui={ui} compactMobile={compactMobile}>AI</SearchSectionHeader>
      {aiBotsLoading ? (
        <div className={joinClasses('flex items-center gap-2 px-3 text-[color:var(--chat-text-secondary)]', compactMobile ? 'pb-3 pt-1 text-[14px]' : 'px-4 pb-2 pt-1 text-[13px]')}>
          <CircularProgress size={16} />
          <span>Loading AI bots…</span>
        </div>
      ) : aiBotsError ? (
        <div className={joinClasses('px-3 text-[13px] text-red-500', compactMobile ? 'pb-3 pt-1 text-[14px]' : 'px-4 pb-2 pt-1')}>
          {aiBotsError}
        </div>
      ) : aiBots.length > 0 ? (
        <div>
          {aiBots.map((bot, index) => (
            <AiConversationRow
              key={`ai-bot-${bot.id}`}
              bot={bot}
              theme={theme}
              ui={ui}
              activeConversationId={activeConversationId}
              onOpenConversation={handleOpenConversation}
              onPrefetchConversation={onPrefetchConversation}
              openingAiBotId={openingAiBotId}
              onOpenAiBot={onOpenAiBot}
              onOpenConversationMenu={handleOpenFolderMenu}
              compactMobile={compactMobile}
              index={index}
              reducedMotion={reducedMotion}
            />
          ))}
        </div>
      ) : (
        <div className={joinClasses('px-3 text-[color:var(--chat-text-secondary)]', compactMobile ? 'pb-3 pt-1 text-[14px]' : 'px-4 pb-2 pt-1 text-[13px]')}>
          AI bots will appear here after admin setup.
        </div>
      )}
      {!compactMobile ? <div className="mx-3 mb-2 mt-2 border-b border-[color:var(--chat-sidebar-divider)]" /> : null}
    </>
  ) : null;

  const mobileSubtitle = unreadTotal > 0
    ? `${unreadTotal} непрочитанных`
    : 'Все прочитано';
  const desktopSubtitle = `${user?.full_name || user?.username || 'Пользователь'} • ${mobileSubtitle}`;

  return (
    <div
      className="chat-native-shell chat-no-select flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--chat-sidebar-bg)]"
      style={{
        '--chat-sidebar-bg': ui.sidebarBg,
        '--chat-sidebar-header-bg': ui.sidebarHeaderBg,
        '--chat-sidebar-search-bg': ui.sidebarSearchBg,
        '--chat-sidebar-search-focus-bg': ui.sidebarSearchFocusBg || ui.sidebarSearchBg,
        '--chat-sidebar-row-active': ui.sidebarRowActive,
        '--chat-sidebar-row-hover': ui.sidebarRowHover,
        '--chat-sidebar-divider': ui.sidebarDivider || ui.borderSoft,
        '--chat-border-soft': ui.borderSoft,
        '--chat-accent-soft': ui.accentSoft,
        '--chat-accent-text': ui.accentText,
        '--chat-text-primary': ui.textPrimary || theme.palette.text.primary,
        '--chat-text-strong': ui.textStrong || theme.palette.text.primary,
        '--chat-text-on-accent': ui.textOnAccent || '#ffffff',
        '--chat-text-secondary': ui.textSecondary,
        '--chat-sidebar-action-text': ui.textPrimary || theme.palette.text.primary,
        '--chat-sidebar-section-label': ui.sidebarSectionLabel || ui.textSecondary,
        '--chat-row-active-subtle': ui.sidebarActiveSubtleText || 'rgba(255,255,255,0.76)',
        '--chat-draft-text': ui.sidebarDraftText || ui.accentText,
        '--chat-search-text': ui.searchText || theme.palette.text.primary,
        '--chat-search-placeholder': ui.searchPlaceholder || ui.textSecondary,
        '--chat-focus-ring': ui.focusRing || alpha(theme.palette.primary.main, 0.26),
        '--chat-unread-bg': ui.accentText || theme.palette.primary.main,
        '--chat-unread-text': ui.textOnAccent || theme.palette.primary.contrastText,
        '--chat-info-card-bg': ui.infoCardBg || ui.surfaceMuted,
        '--chat-info-card-border': ui.infoCardBorder || ui.borderSoft,
        '--chat-info-card-text': ui.infoCardText || ui.textSecondary,
        '--chat-filter-strip-bg': ui.filterStripBg || ui.surfaceMuted,
        '--chat-filter-strip-border': ui.filterStripBorder || ui.borderSoft,
        '--chat-folder-tab-bg': 'transparent',
        '--chat-folder-tab-active-bg': ui.accentText || theme.palette.primary.main,
        '--chat-folder-tab-active-text': ui.textOnAccent || '#ffffff',
        '--chat-skeleton-base': ui.skeletonBase || alpha(theme.palette.text.primary, 0.12),
        '--chat-skeleton-wave': ui.skeletonWave || alpha(theme.palette.common.white, 0.42),
        '--chat-header-action-bg': ui.headerActionBg || alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.05 : 0.06),
        borderRight: isMobile ? 'none' : `1px solid ${ui.borderSoft}`,
      }}
    >
      <div
        className={joinClasses(
          'border-b border-[color:var(--chat-border-soft)] bg-[var(--chat-sidebar-header-bg)] backdrop-blur-2xl',
          compactMobile ? 'chat-safe-top px-2 pt-1 pb-2.5' : 'px-4 pb-4 pt-4',
        )}
      >
        <div className={joinClasses('flex items-center justify-between', compactMobile ? 'mb-3' : 'mb-3.5')}>
          <div className="min-w-0 flex items-center gap-3">
            {showEmbeddedMenuButton ? (
              <SidebarActionButton title="Открыть главное меню" onClick={openDrawer} compactMobile ui={ui}>
                <MenuRoundedIcon fontSize="small" />
              </SidebarActionButton>
            ) : (
              <div
                className="flex items-center justify-center rounded-[14px] text-[var(--chat-accent-text)]"
                style={{
                  width: compactMobile ? 44 : density.sidebarHeaderIcon,
                  height: compactMobile ? 44 : density.sidebarHeaderIcon,
                  backgroundColor: ui.accentSoft,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                <ForumOutlinedIcon fontSize="small" />
              </div>
            )}

            <div className="min-w-0">
              <p className={joinClasses(
                'truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-strong)]',
                compactMobile ? 'text-[17px] leading-5' : 'text-[17px] leading-5',
              )}
              >
                Чаты
              </p>
              <p className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[13px]' : 'text-[13px]')}>
                {compactMobile ? mobileSubtitle : desktopSubtitle}
              </p>
            </div>
          </div>

          <SidebarActionButton title="Новый чат" onClick={onOpenGroup} disabled={chatUnavailable} compactMobile={compactMobile} ui={ui}>
            {compactMobile ? <CreateRoundedIcon fontSize="small" /> : <GroupAddOutlinedIcon fontSize="small" />}
          </SidebarActionButton>
        </div>

        {!sidebarSearchActive ? (
          <div className={compactMobile ? 'mb-2.5' : 'mb-3'}>
            <ChatFolderTabs
              activeFolderKey={activeFolderKey}
              customFolders={customFolders}
              folderUnreadCounts={folderUnreadCounts}
              onFolderChange={onActiveFolderChange}
              disableMotion={reducedMotion}
            />
          </div>
        ) : null}

        <motion.div
          initial={false}
          animate={reducedMotion ? undefined : { y: searchFocused ? -1 : 0, scale: searchFocused ? 1.005 : 1 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
        >
          <div
            className={joinClasses(
              compactMobile
                ? 'flex h-12 items-center rounded-full border px-3 transition duration-150'
                : 'flex h-12 items-center rounded-[16px] border px-3 transition duration-150',
              searchFocused
                ? 'bg-[var(--chat-sidebar-search-focus-bg)] shadow-[0_0_0_3px_var(--chat-focus-ring)]'
                : 'bg-[var(--chat-sidebar-search-bg)]',
            )}
            style={{
              borderColor: searchFocused ? 'transparent' : 'var(--chat-border-soft)',
              height: compactMobile ? undefined : density.sidebarSearchHeight,
            }}
          >
            <SearchRoundedIcon
              fontSize="small"
              sx={{ color: searchFocused ? theme.palette.primary.light : ui.textSecondary }}
            />
            <input
              placeholder="Поиск"
              value={sidebarQuery}
              onChange={(event) => onSidebarQueryChange(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="ml-2 h-full w-full bg-transparent text-[16px] text-[color:var(--chat-search-text)] placeholder:text-[color:var(--chat-search-placeholder)] outline-none"
              style={compactMobile ? undefined : { fontSize: density.sidebarSearchFontSize }}
            />
            <SidebarActionButton
              title="Действия"
              onClick={(event) => setActionsAnchorEl(event.currentTarget)}
              compactMobile={compactMobile}
              ui={ui}
              className="h-9 w-9 bg-transparent"
            >
              <MoreHorizRoundedIcon fontSize="small" />
            </SidebarActionButton>
          </div>
        </motion.div>

        <Menu
          anchorEl={actionsAnchorEl}
          open={Boolean(actionsAnchorEl)}
          onClose={() => setActionsAnchorEl(null)}
          PaperProps={{
            elevation: 12,
            sx: {
              mt: 0.5,
              borderRadius: 1.75,
              minWidth: 220,
            },
          }}
        >
          <MenuItem
            onClick={() => {
              onOpenGroup?.();
              setActionsAnchorEl(null);
            }}
            disabled={chatUnavailable}
          >
            Новый чат
          </MenuItem>
          <MenuItem
            selected={String(activeFolderKey) === 'archived'}
            onClick={() => {
              onOpenArchive?.();
              setActionsAnchorEl(null);
            }}
          >
            <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1.5, color: 'inherit' }} />
            Архив
            {Number(folderUnreadCounts?.archived || 0) > 0
              ? ` (${Number(folderUnreadCounts.archived) > 99 ? '99+' : folderUnreadCounts.archived})`
              : ''}
          </MenuItem>
          <MenuItem
            onClick={() => {
              onOpenFolderManager?.();
              setActionsAnchorEl(null);
            }}
          >
            <SettingsOutlinedIcon fontSize="small" sx={{ mr: 1.5, color: 'inherit' }} />
            Управление папками
          </MenuItem>
          <MenuItem
            onClick={() => {
              onOpenFolderManager?.({ create: true });
              setActionsAnchorEl(null);
            }}
          >
            <CreateRoundedIcon fontSize="small" sx={{ mr: 1.5, color: 'inherit' }} />
            Создать папку
          </MenuItem>
        </Menu>

        <Menu
          anchorReference="anchorPosition"
          anchorPosition={folderMenuPosition || undefined}
          open={Boolean(folderMenuPosition)}
          onClose={handleCloseFolderMenu}
          PaperProps={{
            elevation: 12,
            sx: {
              mt: 0.5,
              borderRadius: 1.75,
              minWidth: 240,
            },
          }}
        >
          <MenuItem disabled sx={{ opacity: 1, fontWeight: 700, maxWidth: 320 }}>
            <span className="truncate">
              {getConversationDisplayTitle(folderMenuConversation)}
            </span>
          </MenuItem>
          <MenuItem
            onClick={() => runConversationSetting({ is_pinned: !folderMenuConversation?.is_pinned })}
            disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
          >
            <PushPinOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            {folderMenuConversation?.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
          </MenuItem>
          <MenuItem
            onClick={() => runConversationSetting({ is_muted: !folderMenuConversation?.is_muted })}
            disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
          >
            <NotificationsOffOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            {folderMenuConversation?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
          </MenuItem>
          <MenuItem
            onClick={() => runConversationSetting({ is_archived: !folderMenuConversation?.is_archived })}
            disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
          >
            <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            {folderMenuConversation?.is_archived ? 'Вернуть из архива' : 'Переместить в архив'}
          </MenuItem>

          <Divider />

          <MenuItem disabled sx={{ opacity: 1, fontWeight: 700 }}>
            <FolderOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            Добавить в папку
          </MenuItem>
          {(Array.isArray(customFolders) ? customFolders : []).length === 0 ? (
            <MenuItem disabled>Нет пользовательских папок</MenuItem>
          ) : null}
          {(Array.isArray(customFolders) ? customFolders : []).map((folder) => {
            const folderId = String(folder?.id || '');
            const checked = selectedFolderIds.has(folderId);
            return (
              <MenuItem
                key={folderId}
                onClick={() => {
                  void onToggleConversationInFolder?.(folderId, folderMenuConversationId, !checked);
                }}
              >
                <Checkbox size="small" checked={checked} sx={{ mr: 1, p: 0.5 }} />
                {folder?.name || 'Папка'}
              </MenuItem>
            );
          })}

          <Divider />

          {isTaskConversation(folderMenuConversation) ? (
            <MenuItem disabled>
              <DeleteOutlineOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              Удаляется вместе с задачей
            </MenuItem>
          ) : String(folderMenuConversation?.kind || '').trim() === 'ai' ? (
            <MenuItem disabled>
              <DeleteOutlineOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              AI-чат нельзя удалить
            </MenuItem>
          ) : (
            <MenuItem
              onClick={
                String(folderMenuConversation?.kind || '').trim() === 'group'
                && String(folderMenuConversation?.viewer_member_role || '').trim() !== 'owner'
                  ? requestConversationLeave
                  : requestConversationDelete
              }
              disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
              sx={{ color: 'error.main' }}
            >
              {String(folderMenuConversation?.kind || '').trim() === 'group'
              && String(folderMenuConversation?.viewer_member_role || '').trim() !== 'owner' ? (
                <ExitToAppRoundedIcon fontSize="small" sx={{ mr: 1.5 }} />
              ) : (
                <DeleteOutlineOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              )}
              {String(folderMenuConversation?.kind || '').trim() === 'group'
              && String(folderMenuConversation?.viewer_member_role || '').trim() !== 'owner'
                ? 'Выйти из группы'
                : 'Удалить чат'}
            </MenuItem>
          )}
        </Menu>
      </div>

      <div
        ref={handleSidebarScrollRef}
        className="chat-scroll-hidden flex-1 overflow-y-auto pb-4"
        data-testid="chat-sidebar-list-scroll"
        style={{ touchAction: isMobile ? 'pan-y' : undefined }}
      >
        <div
          style={{
            transform: folderSwipeOffset ? `translateX(${folderSwipeOffset}px)` : undefined,
            transition: folderSwipeOffset ? 'none' : 'transform 170ms ease-out',
          }}
        >
        {sidebarSearchActive ? (
          <>
            {searchingSidebar ? (
              <SidebarLoadingSkeleton ui={ui} compactMobile={compactMobile} />
            ) : null}

            {!searchingSidebar && searchPeople.length > 0 ? (
              <>
                <SearchSectionHeader ui={ui} compactMobile={compactMobile}>Люди</SearchSectionHeader>
                <div>
                  {searchPeople.map((person) => (
                    <PersonSearchRow
                      key={`person-${person.id}`}
                      person={person}
                      openingPeerId={openingPeerId}
                      onOpenPeer={onOpenPeer}
                      compactMobile={compactMobile}
                      ui={ui}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {!searchingSidebar && searchChats.length > 0 ? (
              <>
                <SearchSectionHeader ui={ui} compactMobile={compactMobile}>Чаты</SearchSectionHeader>
                <div>
                  {searchChats.map((item, index) => (
                    <ConversationRow
                      key={`chat-${item.id}`}
                      item={item}
                      theme={theme}
                      ui={ui}
                      activeConversationId={activeConversationId}
                      onOpenConversation={handleOpenConversation}
                      onPrefetchConversation={onPrefetchConversation}
                      onOpenFolderMenu={handleOpenFolderMenu}
                      draftPreview={draftsByConversation?.[item.id] || ''}
                      compactMobile={compactMobile}
                      index={index}
                      reducedMotion={reducedMotion}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {searchResultEmpty ? (
              <InfoCard compactMobile={compactMobile}>
                Ничего не найдено. Попробуйте фамилию, логин или часть названия чата.
              </InfoCard>
            ) : null}
          </>
        ) : (
          <AnimatePresence mode="wait" initial={!reducedMotion}>
            {conversationsLoading ? (
              <motion.div
                key="sidebar-loading"
                {...folderPanelMotion}
              >
                <SidebarLoadingSkeleton ui={ui} compactMobile={compactMobile} />
              </motion.div>
            ) : conversations.length === 0 ? (
              <motion.div
                key={`folder-empty-${activeFolderKey}`}
                {...folderPanelMotion}
              >
                {aiSection}
                <InfoCard compactMobile={compactMobile}>
                  Чаты пока не найдены. Найдите человека через поиск или создайте новый групповой чат.
                </InfoCard>
              </motion.div>
            ) : (
              <motion.div
                key={`folder-list-${activeFolderKey}`}
                className={compactMobile ? '' : 'pt-2'}
                {...folderPanelMotion}
              >
                {aiSection}
                {taskSections ? (
                  <>
                    <TaskSectionHeader
                      label="Активные"
                      count={taskSections.active.items.length}
                      unreadCount={taskSections.active.unreadCount}
                      compactMobile={compactMobile}
                    />
                    {taskSections.active.items.length > 0 ? taskSections.active.items.map((item, index) => (
                      <ConversationRow
                        key={item.id}
                        item={item}
                        theme={theme}
                        ui={ui}
                        activeConversationId={activeConversationId}
                        onOpenConversation={handleOpenConversation}
                        onPrefetchConversation={onPrefetchConversation}
                        onOpenFolderMenu={handleOpenFolderMenu}
                        draftPreview={draftsByConversation?.[item.id] || ''}
                        compactMobile={compactMobile}
                        index={index}
                        reducedMotion={reducedMotion}
                      />
                    )) : (
                      <div className="px-3 py-2 text-[12px] text-[color:var(--chat-text-secondary)]">
                        Активных задач нет
                      </div>
                    )}

                    <TaskSectionHeader
                      label="Завершённые"
                      count={taskSections.completed.items.length}
                      unreadCount={taskSections.completed.unreadCount}
                      expanded={completedTasksOpen}
                      collapsible
                      onToggle={() => setCompletedTasksOpen((current) => !current)}
                      compactMobile={compactMobile}
                    />
                    {completedTasksOpen ? taskSections.completed.items.map((item, index) => (
                      <ConversationRow
                        key={item.id}
                        item={item}
                        theme={theme}
                        ui={ui}
                        activeConversationId={activeConversationId}
                        onOpenConversation={handleOpenConversation}
                        onPrefetchConversation={onPrefetchConversation}
                        onOpenFolderMenu={handleOpenFolderMenu}
                        draftPreview={draftsByConversation?.[item.id] || ''}
                        compactMobile={compactMobile}
                        index={taskSections.active.items.length + index}
                        reducedMotion={reducedMotion}
                      />
                    )) : null}
                  </>
                ) : conversations.map((item, index) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    theme={theme}
                    ui={ui}
                    activeConversationId={activeConversationId}
                    onOpenConversation={handleOpenConversation}
                    onPrefetchConversation={onPrefetchConversation}
                    onOpenFolderMenu={handleOpenFolderMenu}
                    draftPreview={draftsByConversation?.[item.id] || ''}
                    compactMobile={compactMobile}
                    index={index}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </div>
      </div>
    </div>
  );
}

export default memo(ChatSidebar);
