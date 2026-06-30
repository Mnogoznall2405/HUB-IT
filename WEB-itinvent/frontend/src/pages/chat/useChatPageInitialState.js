import { useMemo, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useLocation, useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';

import { readStoredActiveFolderKey } from '../../components/chat/chatFolderUtils';
import { buildChatUiTokens } from '../../components/chat/chatUiTokens';
import { useMainLayoutShell } from '../../components/layout/MainLayoutShellContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { isChatComposePrefillRoute } from '../../lib/chatComposePrefill';
import { isNativeShellRuntime } from '../../lib/platform';
import { peekSWRCache } from '../../lib/swrCache';
import { canUseAiChatPermission } from './chatAiModel';
import {
  buildChatAiBotsCacheKeyParts,
  buildChatConversationsCacheKeyParts,
  buildChatLastConversationSessionKey,
  buildChatLastMobileViewSessionKey,
  buildChatThreadCacheKeyParts,
} from './chatCacheKeys';
import { CHAT_SWR_STALE_TIME_MS } from './chatPageConstants';
import {
  readSessionStorageValue,
  resolveRestoredMobileView,
} from './chatSessionStorage';
import useChatPageRefs from './useChatPageRefs';

export default function useChatPageInitialState() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const isWideDesktop = useMediaQuery('(min-width:1200px)');
  const compactDesktopMedia = useMediaQuery('(min-width:600px) and (max-width:1920px), (min-width:600px) and (max-height:960px)');
  const ui = useMemo(
    () => buildChatUiTokens(theme, {
      compactDesktop: compactDesktopMedia && !isMobile,
      compactMobile: isPhone,
    }),
    [compactDesktopMedia, isMobile, isPhone, theme],
  );
  const prefersReducedMotion = useReducedMotion();
  const nativeShellRuntime = isNativeShellRuntime();
  const mobileMotionDisabled = prefersReducedMotion || (nativeShellRuntime && isMobile);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const { notifyApiError, notifyInfo, notifyWarning } = useNotification();
  const { closeDrawer } = useMainLayoutShell();
  const userCacheId = String(user?.id || 'guest').trim() || 'guest';
  const canUseAiChat = canUseAiChatPermission(hasPermission);
  const requestedConversationId = String(new URLSearchParams(location.search).get('conversation') || '').trim();
  const requestedMessageId = String(new URLSearchParams(location.search).get('message') || '').trim();
  const composePrefillRequested = isChatComposePrefillRoute(location.search);
  const lastConversationSessionKey = buildChatLastConversationSessionKey(userCacheId);
  const lastMobileViewSessionKey = buildChatLastMobileViewSessionKey(userCacheId);
  const restoredConversationId = !requestedConversationId && !composePrefillRequested
    ? readSessionStorageValue(lastConversationSessionKey)
    : '';
  const restoredMobileView = resolveRestoredMobileView(lastMobileViewSessionKey);
  const initialConversationId = requestedConversationId || restoredConversationId || '';
  const conversationsCacheKeyParts = useMemo(
    () => buildChatConversationsCacheKeyParts(userCacheId),
    [userCacheId],
  );
  const initialConversationsCache = peekSWRCache(conversationsCacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS });
  const aiBotsCacheKeyParts = useMemo(
    () => buildChatAiBotsCacheKeyParts(userCacheId),
    [userCacheId],
  );
  const initialAiBotsCache = canUseAiChat
    ? peekSWRCache(aiBotsCacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
    : null;
  const initialThreadCache = initialConversationId && !requestedMessageId
    ? peekSWRCache(buildChatThreadCacheKeyParts(userCacheId, initialConversationId), { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
    : null;

  const refs = useChatPageRefs({
    canUseAiChat,
    initialAiBotsCache,
    initialConversationId,
    initialConversationsCache,
    initialThreadCache,
  });

  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [conversations, setConversations] = useState(() => (
    Array.isArray(initialConversationsCache?.data?.items) ? initialConversationsCache.data.items : []
  ));
  const [conversationDetailsById, setConversationDetailsById] = useState({});
  const [conversationsLoading, setConversationsLoading] = useState(() => !initialConversationsCache?.data);
  const [conversationBootstrapComplete, setConversationBootstrapComplete] = useState(false);
  const [conversationFilter, setConversationFilter] = useState(() => readStoredActiveFolderKey());
  const [customFolders, setCustomFolders] = useState([]);
  const [conversationIdsByFolder, setConversationIdsByFolder] = useState({});
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const [folderManagerCreateMode, setFolderManagerCreateMode] = useState(false);
  const [folderSaving, setFolderSaving] = useState(false);
  const [aiBots, setAiBots] = useState(() => (
    Array.isArray(initialAiBotsCache?.data?.items) ? initialAiBotsCache.data.items : []
  ));
  const [aiBotsLoading, setAiBotsLoading] = useState(() => (
    canUseAiChat ? !initialAiBotsCache?.data : false
  ));
  const [aiBotsError, setAiBotsError] = useState('');
  const [openingAiBotId, setOpeningAiBotId] = useState('');
  const [aiStatusByConversation, setAiStatusByConversation] = useState({});
  const [activeConversationId, setActiveConversationId] = useState(initialConversationId);
  const [mobileView, setMobileView] = useState(() => (
    isMobile && requestedConversationId
      ? 'thread'
      : (isMobile && restoredConversationId && restoredMobileView === 'thread' ? 'thread' : 'inbox')
  ));
  const [mobileTransitionDirection, setMobileTransitionDirection] = useState(1);
  const [mobileBottomNavHidden, setMobileBottomNavHidden] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  refs.showJumpToLatestRef.current = showJumpToLatest;

  return {
    theme,
    ui,
    isMobile,
    isPhone,
    isWideDesktop,
    prefersReducedMotion,
    nativeShellRuntime,
    mobileMotionDisabled,
    navigate,
    location,
    user,
    hasPermission,
    canUseAiChat,
    notifyApiError,
    notifyInfo,
    notifyWarning,
    closeDrawer,
    userCacheId,
    requestedConversationId,
    requestedMessageId,
    composePrefillRequested,
    lastConversationSessionKey,
    lastMobileViewSessionKey,
    restoredConversationId,
    restoredMobileView,
    initialConversationId,
    conversationsCacheKeyParts,
    initialConversationsCache,
    aiBotsCacheKeyParts,
    initialAiBotsCache,
    initialThreadCache,
    refs,
    health,
    setHealth,
    healthError,
    setHealthError,
    conversations,
    setConversations,
    conversationDetailsById,
    setConversationDetailsById,
    conversationsLoading,
    setConversationsLoading,
    conversationBootstrapComplete,
    setConversationBootstrapComplete,
    conversationFilter,
    setConversationFilter,
    customFolders,
    setCustomFolders,
    conversationIdsByFolder,
    setConversationIdsByFolder,
    foldersLoading,
    setFoldersLoading,
    folderManagerOpen,
    setFolderManagerOpen,
    folderManagerCreateMode,
    setFolderManagerCreateMode,
    folderSaving,
    setFolderSaving,
    aiBots,
    setAiBots,
    aiBotsLoading,
    setAiBotsLoading,
    aiBotsError,
    setAiBotsError,
    openingAiBotId,
    setOpeningAiBotId,
    aiStatusByConversation,
    setAiStatusByConversation,
    activeConversationId,
    setActiveConversationId,
    mobileView,
    setMobileView,
    mobileTransitionDirection,
    setMobileTransitionDirection,
    mobileBottomNavHidden,
    setMobileBottomNavHidden,
    messageText,
    setMessageText,
    pinnedMessage,
    setPinnedMessage,
    showJumpToLatest,
    setShowJumpToLatest,
  };
}
