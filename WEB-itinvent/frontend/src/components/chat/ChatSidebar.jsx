import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Menu,
  MenuItem,
  Skeleton,
  TextField,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
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

import { ConversationAvatar, PresenceAvatar } from './ChatCommon';
import ChatFolderTabs from './ChatFolderTabs';
import { getConversationFolderIds } from './chatFolderUtils';
import { GENERAL_AI_OPENING_ID, groupAiSidebarRowsByDate } from './chatAiSidebarModel';
import { useChatFolderSwipe } from './useChatFolderSwipe';
import { useChatSidebarSearchCollapse } from './useChatSidebarSearchCollapse';
import {
  formatShortTime,
  getConversationDisplayTitle,
  getConversationStatusLine,
  getPersonStatusLine,
  getStatusMeta,
  getTaskConversationMetaLine,
  isCompletedTaskConversation,
  isTaskConversation,
  resolveDirectConversationId,
} from './chatHelpers';
import { formatRuCount } from '../../lib/ruPlural';
import {
  AiConversationRow,
  ConversationRow,
  InfoCard,
  PersonSearchRow,
  SearchSectionHeader,
  SidebarActionButton,
  SidebarLoadingSkeleton,
  SidebarSkeletonRow,
  TaskSectionHeader,
} from './ChatSidebarRows';
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

const RETIRED_AI_AGENT_SLUGS = new Set(['it-helper', 'opencode']);

const isAiAgentAvailableForNewChat = (agent) => {
  const slug = String(agent?.slug || '').trim().toLowerCase();
  const surface = String(agent?.surface || '').trim().toLowerCase();
  const placement = String(agent?.placement || '').trim().toLowerCase();
  return Boolean(agent?.id)
    && agent?.is_enabled !== false
    && placement !== 'hidden'
    && surface !== 'sandbox'
    && !RETIRED_AI_AGENT_SLUGS.has(slug);
};

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
  skipRowEnterAnimation = false,
  conversationsLoading,
  conversations,
  onOpenGroup,
  sidebarScrollRef,
  onSidebarScroll,
  activeFolderKey = 'personal',
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
  aiAgents = [],
  aiBotsLoading = false,
  aiBotsError = '',
  showAiSection: showAiSectionEnabled = false,
  onOpenAiBot,
  onCreateAiBotConversation,
  onCreateAiConversation,
  onRenameAiConversation,
  openingAiBotId = '',
  workspace: controlledWorkspace,
  onWorkspaceChange,
}) {
  const density = getDensity(ui);
  const { openDrawer, headerMode } = useMainLayoutShell();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = disableMotion || prefersReducedMotion;
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);
  const [folderMenuConversation, setFolderMenuConversation] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [sidebarListScrollElement, setSidebarListScrollElement] = useState(null);
  const [completedTasksOpen, setCompletedTasksOpen] = useState(false);
  const [uncontrolledWorkspace, setUncontrolledWorkspace] = useState('chats');
  const workspace = controlledWorkspace === 'ai' || controlledWorkspace === 'chats'
    ? controlledWorkspace
    : uncontrolledWorkspace;
  const setWorkspace = useCallback((nextWorkspace) => {
    const normalizedWorkspace = nextWorkspace === 'ai' ? 'ai' : 'chats';
    if (typeof onWorkspaceChange === 'function') {
      onWorkspaceChange(normalizedWorkspace);
      return;
    }
    setUncontrolledWorkspace(normalizedWorkspace);
  }, [onWorkspaceChange]);
  const [aiArchiveOpen, setAiArchiveOpen] = useState(false);
  const [aiCreatePickerOpen, setAiCreatePickerOpen] = useState(false);
  const [renameConversation, setRenameConversation] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');
  const searchInputRef = useRef(null);
  const showEmbeddedMenuButton = false;
  const chatUnavailable = health?.available === false;
  const showAiSection = Boolean(showAiSectionEnabled);
  const showPeopleSearch = sidebarSearchActive && workspace === 'chats';
  const folderMenuConversationId = String(folderMenuConversation?.id || '').trim();
  const folderMenuConversationKind = String(folderMenuConversation?.kind || '').trim();
  const isAiFolderMenuConversation = folderMenuConversationKind === 'ai';
  const creatingGeneralAiConversation = String(openingAiBotId || '').trim() === GENERAL_AI_OPENING_ID;
  const aiCreatePending = Boolean(String(openingAiBotId || '').trim());
  const availableAiAgents = useMemo(
    () => aiAgents.filter(isAiAgentAvailableForNewChat),
    [aiAgents],
  );
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
    includeAllTab: false,
  });
  const folderPanelMotion = getChatFolderPanelMotionProps(reducedMotion, folderSwipeDirection);
  const {
    collapseProgress,
    expandSearch,
    isSearchCollapsed,
  } = useChatSidebarSearchCollapse({
    enabled: compactMobile,
    reducedMotion,
    scrollElement: sidebarListScrollElement,
    searchActive: sidebarSearchActive,
    searchFocused,
  });
  const handleExpandSearch = useCallback(() => {
    expandSearch();
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
  }, [expandSearch]);
  const handleOpenConversation = useCallback((conversationId) => {
    if (shouldSuppressListClick()) return;
    onOpenConversation?.(conversationId);
  }, [onOpenConversation, shouldSuppressListClick]);
  const handlePrefetchPeerConversation = useCallback((person) => {
    const peerId = Number(person?.id || 0);
    const conversationId = resolveDirectConversationId(peerId, { searchChats });
    if (conversationId) {
      onPrefetchConversation?.(conversationId);
    }
  }, [onPrefetchConversation, searchChats]);
  const handleSidebarScrollRef = useCallback((node) => {
    setScrollElement(node);
    setSidebarListScrollElement(node);
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

  useEffect(() => {
    const activeId = String(activeConversationId || '').trim();
    if (!activeId) return;
    const activeAiConversation = aiBots.find((item) => String(item?.conversation_id || '').trim() === activeId);
    if (activeAiConversation) {
      setWorkspace('ai');
      setAiArchiveOpen(Boolean(activeAiConversation?.is_archived));
    }
  }, [activeConversationId, aiBots, setWorkspace]);

  const filteredAiRows = useMemo(() => {
    const query = String(sidebarQuery || '').trim().toLocaleLowerCase('ru-RU');
    return aiBots.filter((item) => (
      Boolean(item?.is_archived) === aiArchiveOpen
      && (!query || [
      item?.title,
      item?.last_message_preview,
      item?.description,
      ].some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query)))
    ));
  }, [aiArchiveOpen, aiBots, sidebarQuery]);
  const aiHistoryGroups = useMemo(
    () => groupAiSidebarRowsByDate(filteredAiRows),
    [filteredAiRows],
  );

  const handleOpenFolderMenu = useCallback((conversation, event) => {
    setFolderMenuConversation(conversation);
    const fallbackRect = event?.currentTarget?.getBoundingClientRect?.();
    setFolderMenuPosition({
      top: Math.round(Number(event?.clientY || fallbackRect?.bottom || 0)),
      left: Math.round(Number(event?.clientX || fallbackRect?.left || 0)),
    });
  }, []);

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
  const beginRenameAiConversation = () => {
    const conversation = folderMenuConversation;
    handleCloseFolderMenu();
    if (!conversation?.id) return;
    setRenameConversation(conversation);
    setRenameTitle(String(conversation?.title || '').trim());
  };
  const submitAiRename = async () => {
    const conversationId = String(renameConversation?.id || '').trim();
    const title = String(renameTitle || '').trim();
    if (!conversationId || !title) return;
    const updated = await onRenameAiConversation?.(conversationId, title);
    if (updated) {
      setRenameConversation(null);
      setRenameTitle('');
    }
  };
  const openAiCreatePicker = () => {
    if (!chatUnavailable) setAiCreatePickerOpen(true);
  };
  const createPersonalAiConversation = async () => {
    const created = await onCreateAiConversation?.();
    if (created !== null) setAiCreatePickerOpen(false);
  };
  const createAgentConversation = async (agent) => {
    const created = await onCreateAiBotConversation?.(agent);
    if (created !== null) setAiCreatePickerOpen(false);
  };
  const aiSection = showAiSection ? (
    <>
      <div className={compactMobile ? 'px-2 pb-2' : 'px-3 pb-2'}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={openAiCreatePicker}
          disabled={chatUnavailable}
          sx={{ minHeight: 44, borderRadius: 2.5, textTransform: 'none', fontWeight: 800 }}
        >
          Новый чат
        </Button>
      </div>

      <SearchSectionHeader ui={ui} compactMobile={compactMobile}>Мои чаты</SearchSectionHeader>
      {aiHistoryGroups.length > 0 ? (
        aiHistoryGroups.map((group) => (
          <div key={group.key}>
            <SearchSectionHeader ui={ui} compactMobile={compactMobile}>{group.label}</SearchSectionHeader>
            {group.items.map((bot, index) => (
              <AiConversationRow
                key={`ai-conversation-${bot.conversation_id}`}
                bot={bot}
                theme={theme}
                ui={ui}
                active={String(bot?.conversation_id || '').trim() === String(activeConversationId || '').trim()}
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
        ))
      ) : (
        <div className={joinClasses('px-3 text-[color:var(--chat-text-secondary)]', compactMobile ? 'pb-3 pt-1 text-[14px]' : 'px-4 pb-2 pt-1 text-[13px]')}>
          {String(sidebarQuery || '').trim()
            ? 'По вашему запросу AI-диалоги не найдены.'
            : (aiArchiveOpen
              ? 'В архиве пока нет AI-диалогов.'
              : 'Нажмите «Новый чат» и выберите помощника.')}
        </div>
      )}
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
        '--chat-sidebar-row-unread': ui.sidebarRowUnread || ui.accentSoft,
        '--chat-sidebar-row-unread-border': ui.sidebarRowUnreadBorder || alpha(ui.accentText || theme.palette.primary.main, 0.24),
        '--chat-sidebar-unread-indicator': ui.sidebarUnreadIndicator || ui.accentText || theme.palette.primary.main,
        '--chat-sidebar-unread-text': ui.sidebarUnreadText || ui.accentText || theme.palette.primary.main,
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
        '--chat-unread-bg': ui.unreadBadgeBg || theme.palette.primary.dark,
        '--chat-unread-text': ui.unreadBadgeText || theme.palette.primary.contrastText,
        '--chat-unread-active-bg': ui.unreadActiveBadgeBg || '#ffffff',
        '--chat-unread-active-text': ui.unreadActiveBadgeText || ui.sidebarRowActive || theme.palette.primary.dark,
        '--chat-info-card-bg': ui.infoCardBg || ui.surfaceMuted,
        '--chat-info-card-border': ui.infoCardBorder || ui.borderSoft,
        '--chat-info-card-text': ui.infoCardText || ui.textSecondary,
        '--chat-filter-strip-bg': ui.filterStripBg || ui.surfaceMuted,
        '--chat-filter-strip-border': ui.filterStripBorder || ui.borderSoft,
        '--chat-folder-tab-bg': 'transparent',
        '--chat-folder-tab-active-bg': ui.folderTabActiveBg || ui.sidebarRowActive || theme.palette.primary.main,
        '--chat-folder-tab-active-text': ui.folderTabActiveText || ui.textOnAccent || '#ffffff',
        '--chat-folder-tab-active-badge-bg': ui.folderTabActiveBadgeBg || '#ffffff',
        '--chat-folder-tab-active-badge-text': ui.folderTabActiveBadgeText || ui.sidebarRowActive || theme.palette.primary.dark,
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
                {workspace === 'ai' ? <SmartToyOutlinedIcon fontSize="small" /> : <ForumOutlinedIcon fontSize="small" />}
              </div>
            )}

            <div className="min-w-0">
              <p className={joinClasses(
                'truncate font-semibold tracking-[-0.01em] text-[color:var(--chat-text-strong)]',
                compactMobile ? 'text-[17px] leading-5' : 'text-[17px] leading-5',
              )}
              >
                {workspace === 'ai' ? (aiArchiveOpen ? 'ИИ · Архив' : 'ИИ') : 'Чаты'}
              </p>
              <p className={joinClasses('truncate text-[color:var(--chat-text-secondary)]', compactMobile ? 'text-[13px]' : 'text-[13px]')}>
                {workspace === 'ai'
                  ? formatRuCount(aiBots.length, 'диалог', 'диалога', 'диалогов')
                  : (compactMobile ? mobileSubtitle : desktopSubtitle)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <AnimatePresence initial={false}>
              {compactMobile && isSearchCollapsed && !showPeopleSearch ? (
                <motion.div
                  key="sidebar-header-search"
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reducedMotion ? undefined : { opacity: 0, scale: 0.92 }}
                  transition={reducedMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
                >
                  <SidebarActionButton
                    title="Поиск"
                    aria-label="Поиск"
                    onClick={handleExpandSearch}
                    compactMobile={compactMobile}
                    ui={ui}
                  >
                    <SearchRoundedIcon fontSize="small" />
                  </SidebarActionButton>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <SidebarActionButton
              title={workspace === 'ai' ? 'Новый AI-чат' : 'Новый чат'}
              onClick={workspace === 'ai' ? openAiCreatePicker : onOpenGroup}
              disabled={chatUnavailable}
              compactMobile={compactMobile}
              ui={ui}
            >
              {workspace === 'ai' || compactMobile ? <CreateRoundedIcon fontSize="small" /> : <GroupAddOutlinedIcon fontSize="small" />}
            </SidebarActionButton>
          </div>
        </div>

        {showAiSection ? (
          <div
            role="tablist"
            aria-label="Раздел чата"
            className="mb-3 grid grid-cols-2 gap-1 rounded-[14px] border border-[color:var(--chat-border-soft)] bg-[var(--chat-filter-strip-bg)] p-1"
          >
            {[
              { key: 'chats', label: 'Чаты' },
              { key: 'ai', label: 'ИИ' },
            ].map((tab) => {
              const selected = workspace === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setWorkspace(tab.key);
                    if (tab.key === 'ai') setAiArchiveOpen(false);
                  }}
                  className="min-h-11 rounded-[11px] px-3 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-focus-ring)]"
                  style={{
                    backgroundColor: selected ? 'var(--chat-folder-tab-active-bg)' : 'transparent',
                    color: selected ? 'var(--chat-folder-tab-active-text)' : 'var(--chat-text-secondary)',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {workspace === 'chats' && !showPeopleSearch ? (
          <div className={compactMobile ? 'mb-2' : 'mb-3'}>
            <ChatFolderTabs
              activeFolderKey={activeFolderKey}
              customFolders={customFolders}
              folderUnreadCounts={folderUnreadCounts}
              onFolderChange={onActiveFolderChange}
              disableMotion={reducedMotion}
              includeAllTab={false}
            />
          </div>
        ) : null}

        {compactMobile ? (
          <motion.div
            initial={false}
            animate={reducedMotion ? undefined : {
              height: Math.round(density.sidebarSearchHeight * (1 - collapseProgress)),
              opacity: 1 - collapseProgress * 0.85,
              marginBottom: Math.round(10 * (1 - collapseProgress)),
            }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
            style={{
              overflow: 'hidden',
              pointerEvents: collapseProgress >= 0.98 ? 'none' : 'auto',
            }}
            aria-hidden={collapseProgress >= 0.98}
          >
            <div
              className={joinClasses(
                'flex h-12 items-center rounded-full border px-3 transition duration-150',
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
                ref={searchInputRef}
                placeholder={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск'}
                value={sidebarQuery}
                onChange={(event) => onSidebarQueryChange(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                className="ml-2 h-full w-full bg-transparent text-[16px] text-[color:var(--chat-search-text)] placeholder:text-[color:var(--chat-search-placeholder)] outline-none"
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
        ) : (
        <motion.div
          initial={false}
          animate={reducedMotion ? undefined : { y: searchFocused ? -1 : 0, scale: searchFocused ? 1.005 : 1 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
        >
          <div
            className={joinClasses(
              'flex h-12 items-center rounded-[16px] border px-3 transition duration-150',
              searchFocused
                ? 'bg-[var(--chat-sidebar-search-focus-bg)] shadow-[0_0_0_3px_var(--chat-focus-ring)]'
                : 'bg-[var(--chat-sidebar-search-bg)]',
            )}
            style={{
              borderColor: searchFocused ? 'transparent' : 'var(--chat-border-soft)',
              height: density.sidebarSearchHeight,
            }}
          >
            <SearchRoundedIcon
              fontSize="small"
              sx={{ color: searchFocused ? theme.palette.primary.light : ui.textSecondary }}
            />
            <input
              placeholder={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск'}
              value={sidebarQuery}
              onChange={(event) => onSidebarQueryChange(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="ml-2 h-full w-full bg-transparent text-[16px] text-[color:var(--chat-search-text)] placeholder:text-[color:var(--chat-search-placeholder)] outline-none"
              style={{ fontSize: density.sidebarSearchFontSize }}
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
        )}

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
              if (workspace === 'ai') openAiCreatePicker();
              else onOpenGroup?.();
              setActionsAnchorEl(null);
            }}
            disabled={chatUnavailable}
          >
            {workspace === 'ai' ? 'Новый AI-чат' : 'Новый чат'}
          </MenuItem>
          <MenuItem
            selected={workspace === 'ai' ? aiArchiveOpen : String(activeFolderKey) === 'archived'}
            onClick={() => {
              if (workspace === 'ai') setAiArchiveOpen((current) => !current);
              else onOpenArchive?.();
              setActionsAnchorEl(null);
            }}
          >
            <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1.5, color: 'inherit' }} />
            Архив
            {workspace !== 'ai' && Number(folderUnreadCounts?.archived || 0) > 0
              ? ` (${Number(folderUnreadCounts.archived) > 99 ? '99+' : folderUnreadCounts.archived})`
              : ''}
          </MenuItem>
          {workspace === 'chats' ? (
            <>
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
            </>
          ) : null}
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
          {isAiFolderMenuConversation ? (
            <MenuItem
              onClick={beginRenameAiConversation}
              disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
            >
              <EditOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              Переименовать
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => runConversationSetting({ is_pinned: !folderMenuConversation?.is_pinned })}
            disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
          >
            <PushPinOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            {folderMenuConversation?.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
          </MenuItem>
          {!isAiFolderMenuConversation ? (
            <MenuItem
              onClick={() => runConversationSetting({ is_muted: !folderMenuConversation?.is_muted })}
              disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
            >
              <NotificationsOffOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              {folderMenuConversation?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => runConversationSetting({ is_archived: !folderMenuConversation?.is_archived })}
            disabled={!folderMenuConversationId || conversationActionPendingId === folderMenuConversationId}
          >
            <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
            {folderMenuConversation?.is_archived ? 'Вернуть из архива' : 'Переместить в архив'}
          </MenuItem>

          {!isAiFolderMenuConversation ? (
            <>
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
            </>
          ) : null}

          <Divider />

          {isTaskConversation(folderMenuConversation) ? (
            <MenuItem disabled>
              <DeleteOutlineOutlinedIcon fontSize="small" sx={{ mr: 1.5 }} />
              Удаляется вместе с задачей
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
        onScroll={onSidebarScroll}
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
        {workspace === 'ai' ? (
          <div className={compactMobile ? 'pt-2' : 'pt-3'}>
            {aiSection}
          </div>
        ) : showPeopleSearch ? (
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
                      onPrefetchPeerConversation={handlePrefetchPeerConversation}
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
                      active={item.id === activeConversationId}
                      onOpenConversation={handleOpenConversation}
                      onPrefetchConversation={onPrefetchConversation}
                      onOpenFolderMenu={handleOpenFolderMenu}
                      draftPreview={draftsByConversation?.[item.id] || ''}
                      compactMobile={compactMobile}
                      index={index}
                      reducedMotion={reducedMotion}
                      skipEnterAnimation={skipRowEnterAnimation}
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
                        active={item.id === activeConversationId}
                        onOpenConversation={handleOpenConversation}
                        onPrefetchConversation={onPrefetchConversation}
                        onOpenFolderMenu={handleOpenFolderMenu}
                        draftPreview={draftsByConversation?.[item.id] || ''}
                        compactMobile={compactMobile}
                        index={index}
                        reducedMotion={reducedMotion}
                        skipEnterAnimation={skipRowEnterAnimation}
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
                        active={item.id === activeConversationId}
                        onOpenConversation={handleOpenConversation}
                        onPrefetchConversation={onPrefetchConversation}
                        onOpenFolderMenu={handleOpenFolderMenu}
                        draftPreview={draftsByConversation?.[item.id] || ''}
                        compactMobile={compactMobile}
                        index={taskSections.active.items.length + index}
                        reducedMotion={reducedMotion}
                        skipEnterAnimation={skipRowEnterAnimation}
                      />
                    )) : null}
                  </>
                ) : conversations.map((item, index) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    theme={theme}
                    ui={ui}
                    active={item.id === activeConversationId}
                    onOpenConversation={handleOpenConversation}
                    onPrefetchConversation={onPrefetchConversation}
                    onOpenFolderMenu={handleOpenFolderMenu}
                    draftPreview={draftsByConversation?.[item.id] || ''}
                    compactMobile={compactMobile}
                    index={index}
                    reducedMotion={reducedMotion}
                    skipEnterAnimation={skipRowEnterAnimation}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </div>
      </div>

      <Dialog
        open={aiCreatePickerOpen}
        onClose={() => {
          if (!aiCreatePending) setAiCreatePickerOpen(false);
        }}
        fullWidth
        fullScreen={compactMobile}
        maxWidth="xs"
        aria-labelledby="ai-create-dialog-title"
        aria-describedby="ai-create-dialog-description"
      >
        <DialogTitle id="ai-create-dialog-title">Новый AI-чат</DialogTitle>
        <DialogContent>
          <p id="ai-create-dialog-description" className="mb-4 text-[14px]" style={{ color: ui.textSecondary }}>
            Выберите помощника. Для каждого нового чата создаётся отдельная история.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              fullWidth
              variant="outlined"
              startIcon={creatingGeneralAiConversation ? <CircularProgress size={18} /> : <SmartToyOutlinedIcon />}
              onClick={() => void createPersonalAiConversation()}
              disabled={aiCreatePending}
              sx={{ minHeight: 64, justifyContent: 'flex-start', borderRadius: 2, textAlign: 'left', textTransform: 'none' }}
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-bold">HUB Ассистент</span>
                <span className="block truncate text-[13px] font-normal opacity-75">Общение, база знаний, файлы и документы</span>
              </span>
            </Button>

            {aiBotsLoading && availableAiAgents.length === 0 ? (
              <div className="flex min-h-11 items-center gap-2 px-2 text-[13px]" style={{ color: ui.textSecondary }}>
                <CircularProgress size={16} />
                <span>Загружаю корпоративных помощников…</span>
              </div>
            ) : null}

            {availableAiAgents.map((agent) => {
              const isOpening = String(openingAiBotId || '').trim() === String(agent.id || '').trim();
              return (
                <Button
                  key={`ai-create-agent-${agent.id}`}
                  fullWidth
                  variant="outlined"
                  startIcon={isOpening ? <CircularProgress size={18} /> : <SmartToyOutlinedIcon />}
                  onClick={() => void createAgentConversation(agent)}
                  disabled={aiCreatePending}
                  sx={{ minHeight: 64, justifyContent: 'flex-start', borderRadius: 2, textAlign: 'left', textTransform: 'none' }}
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold">{agent.title}</span>
                    <span className="block truncate text-[13px] font-normal opacity-75">
                      {agent.description || 'Корпоративный помощник HUB'}
                    </span>
                  </span>
                </Button>
              );
            })}

            {aiBotsError ? (
              <p role="alert" className="px-2 text-[13px] text-red-500">
                Корпоративные помощники временно недоступны. HUB Ассистент продолжает работать.
              </p>
            ) : null}
            {!aiBotsLoading && !aiBotsError && availableAiAgents.length === 0 ? (
              <p className="px-2 text-[13px]" style={{ color: ui.textSecondary }}>
                Корпоративные помощники пока недоступны.
              </p>
            ) : null}
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiCreatePickerOpen(false)} disabled={aiCreatePending} sx={{ minHeight: 44 }}>
            Отмена
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(renameConversation)}
        onClose={() => setRenameConversation(null)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="ai-rename-dialog-title"
      >
        <DialogTitle id="ai-rename-dialog-title">Переименовать AI-диалог</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Название диалога"
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
            inputProps={{ maxLength: 255 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitAiRename();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameConversation(null)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={() => void submitAiRename()}
            disabled={!String(renameTitle || '').trim() || conversationActionPendingId === String(renameConversation?.id || '')}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default memo(ChatSidebar);
