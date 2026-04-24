import { memo, useMemo, useState } from 'react';
import { CircularProgress, Menu, MenuItem, Skeleton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { motion, useReducedMotion } from 'framer-motion';

import { PresenceAvatar } from './ChatCommon';
import { formatShortTime, getConversationStatusLine, getPersonStatusLine } from './chatHelpers';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';

const FILTERS = [
  { value: 'all', label: 'Все чаты' },
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'direct', label: 'Личные' },
  { value: 'group', label: 'Группы' },
  { value: 'pinned', label: 'Закреплённые' },
  { value: 'archived', label: 'Архив' },
];

const joinClasses = (...values) => values.filter(Boolean).join(' ');

function SidebarSkeletonRow({ compactMobile = false, align = 'left' }) {
  return (
    <div
      className={joinClasses(
        'flex items-center gap-2.5',
        compactMobile ? 'border-b px-3 py-2.5' : 'mx-1.5 my-0.5 rounded-[12px] px-3 py-2.5',
      )}
      style={{ borderColor: 'var(--chat-sidebar-divider)' }}
    >
      <Skeleton
        variant="circular"
        width={compactMobile ? 54 : 52}
        height={compactMobile ? 54 : 52}
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

function SidebarLoadingSkeleton({ compactMobile = false }) {
  return (
    <div className={compactMobile ? 'pt-1' : 'pt-2'}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <SidebarSkeletonRow key={index} compactMobile={compactMobile} align={index % 2 ? 'right' : 'left'} />
      ))}
    </div>
  );
}

function SearchSectionHeader({ children, compactMobile = false }) {
  return (
    <div className={joinClasses(
      'px-3 font-semibold uppercase tracking-[0.12em] text-[color:var(--chat-sidebar-section-label)]',
      compactMobile ? 'pb-1 pt-3 text-[10px]' : 'pb-1.5 pt-4 text-[11px]',
    )}
    >
      {children}
    </div>
  );
}

function SidebarActionButton({
  title,
  children,
  onClick,
  disabled = false,
  compactMobile = false,
  className = '',
}) {
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
          style={{ backgroundColor: 'var(--chat-header-action-bg)' }}
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
  activeConversationId,
  onOpenConversation,
  onPrefetchConversation,
  draftPreview,
  compactMobile = false,
  index = 0,
  reducedMotion = false,
}) {
  const unreadCount = Number(item?.unread_count || 0);
  const active = item.id === activeConversationId;
  const previewText = draftPreview || (item?.kind === 'ai'
    ? `AI • ${String(item?.last_message_preview || '').trim() || 'Готов к диалогу'}`
    : getConversationStatusLine(item));

  return (
    <motion.div
      layout
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.18, delay: Math.min(index, 7) * 0.02 }}
    >
      <button
        type="button"
        onClick={() => onOpenConversation(item.id)}
        onPointerDown={() => onPrefetchConversation?.(item.id)}
        onTouchStart={() => onPrefetchConversation?.(item.id)}
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
          <PresenceAvatar
            item={item.kind === 'direct' ? (item.direct_peer || item) : item}
            online={Boolean(item?.kind === 'direct' && item?.direct_peer?.presence?.is_online)}
            size={compactMobile ? 54 : 52}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className={joinClasses(
                'truncate leading-[1.15] tracking-[-0.01em]',
                compactMobile ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold',
              )}
              >
                {item.title}
              </p>
              <span className={joinClasses(
                'shrink-0 pt-0.5 text-right',
                compactMobile ? 'text-[12px]' : 'text-[12px]',
                active ? 'text-[color:var(--chat-row-active-subtle)]' : 'text-[color:var(--chat-text-secondary)]',
              )}
              >
                {formatShortTime(item.last_message_at || item.updated_at)}
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
              >
                {draftPreview ? `Черновик: ${draftPreview}` : previewText}
              </p>

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
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function PersonSearchRow({ person, openingPeerId, onOpenPeer, compactMobile = false }) {
  const opening = openingPeerId === String(person.id);

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
    >
      <PresenceAvatar item={person} online={Boolean(person?.presence?.is_online)} size={compactMobile ? 54 : 50} />
      <div className="min-w-0 flex-1">
        <p className={joinClasses('truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-primary)]', compactMobile ? 'text-[17px]' : 'text-[16px]')}>
          {person.full_name || person.username}
        </p>
        <p className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[14px]' : 'text-[13px]')}>
          {getPersonStatusLine(person)}
        </p>
      </div>
      {opening ? <CircularProgress size={18} /> : null}
    </button>
  );
}

function AiBotRow({ bot, openingAiBotId, onOpenAiBot, compactMobile = false }) {
  const opening = String(openingAiBotId || '').trim() === String(bot?.id || '').trim();
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
    >
      <PresenceAvatar item={{ title: bot?.title || 'AI', username: bot?.slug || 'ai' }} online={false} size={compactMobile ? 54 : 50} />
      <div className="min-w-0 flex-1">
        <p className={joinClasses('truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-primary)]', compactMobile ? 'text-[17px]' : 'text-[16px]')}>
          {bot?.title || 'AI'}
        </p>
        <p className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[14px]' : 'text-[13px]')}>
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
  activeConversationId,
  onOpenConversation,
  onPrefetchConversation,
  openingAiBotId,
  onOpenAiBot,
  compactMobile = false,
  index = 0,
  reducedMotion = false,
}) {
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
      layout
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
          <PresenceAvatar item={{ title: bot?.title || 'AI', username: bot?.slug || 'ai' }} online={false} size={compactMobile ? 54 : 52} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className={joinClasses(
                'truncate leading-[1.15] tracking-[-0.01em]',
                compactMobile ? 'text-[16px] font-semibold' : 'text-[15px] font-semibold',
              )}
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
  conversationFilter,
  onConversationFilterChange,
  conversationFilterCounts,
  draftsByConversation,
  aiBots = [],
  aiBotsLoading = false,
  aiBotsError = '',
  showAiSection = false,
  onOpenAiBot,
  openingAiBotId = '',
}) {
  const { openDrawer, headerMode } = useMainLayoutShell();
  const reducedMotion = useReducedMotion();
  const [filterAnchorEl, setFilterAnchorEl] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const showEmbeddedMenuButton = compactMobile && headerMode !== 'notifications-only';
  const activeFilter = useMemo(
    () => FILTERS.find((item) => item.value === conversationFilter) || FILTERS[0],
    [conversationFilter],
  );
  const chatUnavailable = health?.available === false;
  const aiSection = showAiSection ? (
    <>
      <SearchSectionHeader compactMobile={compactMobile}>AI</SearchSectionHeader>
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
              activeConversationId={activeConversationId}
              onOpenConversation={onOpenConversation}
              onPrefetchConversation={onPrefetchConversation}
              openingAiBotId={openingAiBotId}
              onOpenAiBot={onOpenAiBot}
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
              <SidebarActionButton title="Открыть главное меню" onClick={openDrawer} compactMobile>
                <MenuRoundedIcon fontSize="small" />
              </SidebarActionButton>
            ) : (
              <div
                className="flex items-center justify-center rounded-[14px] text-[var(--chat-accent-text)]"
                style={{
                  width: compactMobile ? 40 : 42,
                  height: compactMobile ? 40 : 42,
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

          <SidebarActionButton title="Новый чат" onClick={onOpenGroup} disabled={chatUnavailable} compactMobile={compactMobile}>
            {compactMobile ? <CreateRoundedIcon fontSize="small" /> : <GroupAddOutlinedIcon fontSize="small" />}
          </SidebarActionButton>
        </div>

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
            style={{ borderColor: searchFocused ? 'transparent' : 'var(--chat-border-soft)' }}
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
            />
            <SidebarActionButton
              title="Фильтр списка"
              onClick={(event) => setFilterAnchorEl(event.currentTarget)}
              compactMobile={compactMobile}
              className="h-9 w-9 bg-transparent"
            >
              <MoreHorizRoundedIcon fontSize="small" />
            </SidebarActionButton>
          </div>
        </motion.div>

        {!compactMobile ? (
          <div
            className="mt-3 flex items-center justify-between rounded-[14px] border px-3 py-2"
            style={{
              borderColor: 'var(--chat-filter-strip-border)',
              backgroundColor: 'var(--chat-filter-strip-bg)',
            }}
          >
            <span className="text-[12px] font-semibold text-[color:var(--chat-text-secondary)]">
              {activeFilter.label}
              {conversationFilterCounts?.[activeFilter.value] ? ` • ${conversationFilterCounts[activeFilter.value]}` : ''}
            </span>
            {chatUnavailable ? (
              <span className="text-[12px] font-semibold text-amber-400">
                Offline
              </span>
            ) : null}
          </div>
        ) : null}

        <Menu
          anchorEl={filterAnchorEl}
          open={Boolean(filterAnchorEl)}
          onClose={() => setFilterAnchorEl(null)}
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
              setFilterAnchorEl(null);
            }}
            disabled={chatUnavailable}
          >
            Новый чат
          </MenuItem>
          {FILTERS.map((filter) => (
            <MenuItem
              key={filter.value}
              selected={conversationFilter === filter.value}
              onClick={() => {
                onConversationFilterChange?.(filter.value);
                setFilterAnchorEl(null);
              }}
            >
              {filter.label}
              {conversationFilterCounts?.[filter.value] ? ` • ${conversationFilterCounts[filter.value]}` : ''}
            </MenuItem>
          ))}
        </Menu>
      </div>

      <div
        ref={sidebarScrollRef}
        className="chat-scroll-hidden flex-1 overflow-y-auto pb-4"
      >
        {sidebarSearchActive ? (
          <>
            {searchingSidebar ? (
              <SidebarLoadingSkeleton compactMobile={compactMobile} />
            ) : null}

            {!searchingSidebar && searchPeople.length > 0 ? (
              <>
                <SearchSectionHeader compactMobile={compactMobile}>Люди</SearchSectionHeader>
                <div>
                  {searchPeople.map((person) => (
                    <PersonSearchRow
                      key={`person-${person.id}`}
                      person={person}
                      openingPeerId={openingPeerId}
                      onOpenPeer={onOpenPeer}
                      compactMobile={compactMobile}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {!searchingSidebar && searchChats.length > 0 ? (
              <>
                <SearchSectionHeader compactMobile={compactMobile}>Чаты</SearchSectionHeader>
                <div>
                  {searchChats.map((item, index) => (
                    <ConversationRow
                      key={`chat-${item.id}`}
                      item={item}
                      theme={theme}
                      activeConversationId={activeConversationId}
                      onOpenConversation={onOpenConversation}
                      onPrefetchConversation={onPrefetchConversation}
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
        ) : conversationsLoading ? (
          <SidebarLoadingSkeleton compactMobile={compactMobile} />
        ) : conversations.length === 0 ? (
          <>
            {aiSection}
            <InfoCard compactMobile={compactMobile}>
            Чаты пока не найдены. Найдите человека через поиск или создайте новый групповой чат.
            </InfoCard>
          </>
        ) : (
          <div className={compactMobile ? '' : 'pt-2'}>
            {aiSection}
            {conversations.map((item, index) => (
              <ConversationRow
                key={item.id}
                item={item}
                theme={theme}
                activeConversationId={activeConversationId}
                onOpenConversation={onOpenConversation}
                onPrefetchConversation={onPrefetchConversation}
                draftPreview={draftsByConversation?.[item.id] || ''}
                compactMobile={compactMobile}
                index={index}
                reducedMotion={reducedMotion}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChatSidebar);
