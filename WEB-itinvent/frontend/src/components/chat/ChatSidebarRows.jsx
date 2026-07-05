import { useRef } from 'react';
import { Checkbox, CircularProgress, Menu, MenuItem, Skeleton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ExitToAppRoundedIcon from '@mui/icons-material/ExitToAppRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { motion } from 'framer-motion';

import { AiConversationAvatar, ConversationAvatar, PresenceAvatar } from './ChatCommon';
import { getConversationFolderIds } from './chatFolderUtils';
import {
  formatShortTime,
  formatSidebarConversationTime,
  getConversationDisplayTitle,
  getConversationStatusLine,
  getPersonStatusLine,
  getStatusMeta,
  getTaskConversationMetaLine,
  isCompletedTaskConversation,
  isTaskConversation,
} from './chatHelpers';

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

function ConversationRowMeta({
  item,
  active,
  compactMobile,
  ui,
  theme,
}) {
  const showReceipts = item?.kind === 'direct'
    && item?.last_message_is_own
    && item?.last_message_delivery_status;
  const deliveryStatus = String(item?.last_message_delivery_status || '').trim();
  const readColor = active
    ? 'var(--chat-row-active-subtle)'
    : (ui?.statusReadText || ui?.accentText || theme.palette.primary.light);
  const sentColor = active
    ? 'var(--chat-row-active-subtle)'
    : 'var(--chat-text-secondary)';
  const receiptColor = deliveryStatus === 'read' ? readColor : sentColor;
  const subtleIconColor = active ? 'var(--chat-row-active-subtle)' : 'var(--chat-text-secondary)';

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
      <div className="flex items-center gap-0.5">
        {showReceipts ? (
          deliveryStatus === 'read'
            ? <DoneAllRoundedIcon data-testid="sidebar-delivery-read" sx={{ fontSize: 15, color: receiptColor }} />
            : <DoneRoundedIcon data-testid="sidebar-delivery-sent" sx={{ fontSize: 15, color: receiptColor }} />
        ) : null}
        <span className={joinClasses(
          'text-right',
          compactMobile ? 'text-[12px]' : 'text-[12px]',
          active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]',
        )}
        >
          {formatSidebarConversationTime(item.last_message_at || item.updated_at)}
        </span>
      </div>
      {!compactMobile && (item.is_pinned || item.is_muted || item.is_archived) ? (
        <div className="flex items-center gap-0.5">
          {item.is_pinned ? <PushPinOutlinedIcon sx={{ fontSize: 15, color: subtleIconColor }} /> : null}
          {item.is_muted ? <NotificationsOffOutlinedIcon sx={{ fontSize: 15, color: subtleIconColor }} /> : null}
          {item.is_archived ? <ArchiveOutlinedIcon sx={{ fontSize: 15, color: subtleIconColor }} /> : null}
        </div>
      ) : null}
    </div>
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
  skipEnterAnimation = false,
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
      initial={reducedMotion || skipEnterAnimation ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion || skipEnterAnimation ? { duration: 0 } : { duration: 0.18, delay: Math.min(index, 7) * 0.02 }}
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
              <ConversationRowMeta
                item={item}
                active={active}
                compactMobile={compactMobile}
                ui={ui}
                theme={theme}
              />
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

function PersonSearchRow({
  person,
  openingPeerId,
  onOpenPeer,
  onPrefetchPeerConversation,
  compactMobile = false,
  ui,
}) {
  const opening = openingPeerId === String(person.id);
  const density = getDensity(ui);

  const handlePrefetch = () => {
    onPrefetchPeerConversation?.(person);
  };

  return (
    <button
      type="button"
      onClick={() => void onOpenPeer(person)}
      onPointerDown={handlePrefetch}
      onTouchStart={handlePrefetch}
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


export {
  SidebarSkeletonRow,
  SidebarLoadingSkeleton,
  SearchSectionHeader,
  TaskSectionHeader,
  SidebarActionButton,
  ConversationRow,
  PersonSearchRow,
  AiBotRow,
  AiConversationRow,
  InfoCard,
};
