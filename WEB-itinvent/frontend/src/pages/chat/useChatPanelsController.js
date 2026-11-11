import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { invalidateSWRCacheByPrefix } from '../../lib/swrCache';
import { patchTaskConversationFromTask } from './chatConversationModel';
import { persistChatTaskPanelCollapsed, readStoredChatTaskPanelCollapsed } from './chatRightPanelLayout';
import { buildTaskDetailPath } from '../../lib/taskNavigation';

export const CONTEXT_PANEL_ENTER_MS = 220;
export const CONTEXT_PANEL_EXIT_MS = 180;

export const loadChatContextPanelModule = () => import('../../components/chat/ChatContextPanel');
export const loadTaskWorkspacePanelModule = () => import('../../components/hub/TaskWorkspacePanel');

export function computePanelVisibility({
  isMobile = false,
  isWideDesktop = false,
  contextPanelOpen = false,
  taskPanelOpen = false,
  taskPanelTaskId = '',
  hasActiveConversation = false,
} = {}) {
  const showContextPanel = !isMobile && contextPanelOpen;
  const showTaskPanel = !isMobile && taskPanelOpen && Boolean(taskPanelTaskId);
  const renderDesktopRightPanel = !isMobile && hasActiveConversation && (showContextPanel || showTaskPanel);
  const renderPersistentRightPanel = renderDesktopRightPanel && isWideDesktop;
  return {
    showContextPanel,
    showTaskPanel,
    renderDesktopRightPanel,
    renderPersistentRightPanel,
  };
}

export function computeContextPanelDurations(
  prefersReducedMotion = false,
  enterMs = CONTEXT_PANEL_ENTER_MS,
  exitMs = CONTEXT_PANEL_EXIT_MS,
) {
  return {
    contextPanelEnterDuration: prefersReducedMotion ? 1 : enterMs,
    contextPanelExitDuration: prefersReducedMotion ? 1 : exitMs,
  };
}

export default function useChatPanelsController({
  activeConversation,
  activeConversationIdRef,
  activeTaskConversationTaskId,
  getCurrentBrowserConversationId,
  getMobileNav,
  isMobile,
  isWideDesktop,
  loadChatDialogsModule,
  loadConversationDetail,
  loadConversationsRef,
  mobileHistoryReadyRef,
  prefersReducedMotion,
  setConversations,
  setConversationDetailsById,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setThreadMenuAnchor,
  userId,
  disableTaskPanel = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [infoOpen, setInfoOpen] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [taskPanelTaskId, setTaskPanelTaskId] = useState('');

  const {
    showContextPanel,
    showTaskPanel,
    renderDesktopRightPanel,
    renderPersistentRightPanel,
  } = useMemo(
    () => computePanelVisibility({
      isMobile,
      isWideDesktop,
      contextPanelOpen,
      taskPanelOpen,
      taskPanelTaskId,
      hasActiveConversation: Boolean(activeConversation),
    }),
    [activeConversation, contextPanelOpen, isMobile, isWideDesktop, taskPanelOpen, taskPanelTaskId],
  );

  const { contextPanelEnterDuration, contextPanelExitDuration } = useMemo(
    () => computeContextPanelDurations(prefersReducedMotion),
    [prefersReducedMotion],
  );

  useEffect(() => {
    if (isMobile) return;
    if (disableTaskPanel) {
      setTaskPanelOpen(false);
      setTaskPanelTaskId('');
      return;
    }
    setTaskPanelTaskId(activeTaskConversationTaskId);
    if (activeTaskConversationTaskId) {
      setContextPanelOpen(false);
      void loadTaskWorkspacePanelModule();
      if (!readStoredChatTaskPanelCollapsed()) {
        setTaskPanelOpen(true);
      }
      return;
    }
    setTaskPanelOpen(false);
  }, [activeTaskConversationTaskId, disableTaskPanel, isMobile]);

  const openTaskInTasks = useCallback(() => {
    navigate('/tasks');
  }, [navigate]);

  const openTaskFromChat = useCallback((taskId) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return;
    navigate(buildTaskDetailPath(normalizedTaskId), {
      state: {
        taskReturnTo: `${location.pathname}${location.search || ''}`,
        taskReturnLabel: 'Назад в чат',
      },
    });
  }, [location.pathname, location.search, navigate]);

  const closeTaskPanel = useCallback(() => {
    persistChatTaskPanelCollapsed(true);
    setTaskPanelOpen(false);
  }, []);

  const handleTaskPanelUpdated = useCallback((updatedTask) => {
    const updatedTaskId = String(updatedTask?.id || '').trim();
    if (!updatedTaskId) return;
    setConversations((current) => current.map(
      (conversation) => patchTaskConversationFromTask(conversation, updatedTask),
    ));
    setConversationDetailsById((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([conversationId, conversation]) => {
        if (String(conversation?.task_id || '').trim() !== updatedTaskId) return;
        next[conversationId] = patchTaskConversationFromTask(conversation, updatedTask);
        changed = true;
      });
      return changed ? next : current;
    });
    invalidateSWRCacheByPrefix('chat', 'conversations', String(userId || 'guest'));
    const activeId = String(activeConversationIdRef.current || '').trim();
    if (activeId) {
      void loadConversationDetail(activeId, { force: true }).catch(() => {});
    }
    void loadConversationsRef.current?.({ silent: true, force: true }).catch(() => {});
  }, [activeConversationIdRef, loadConversationDetail, loadConversationsRef, setConversationDetailsById, setConversations, userId]);

  const closeMobileInfoView = useCallback(() => {
    if (!isMobile) {
      setInfoOpen(false);
      return;
    }
    const mobileNav = getMobileNav?.() || {};
    const currentMobileHistoryState = typeof window !== 'undefined' && mobileHistoryReadyRef.current
      ? mobileNav.readMobileHistoryState?.()
      : null;
    if (currentMobileHistoryState?.view === 'thread' && currentMobileHistoryState?.infoOpen) {
      setInfoOpen(false);
      window.history.back();
      return;
    }
    setInfoOpen(false);
  }, [getMobileNav, isMobile, mobileHistoryReadyRef]);

  const handleOpenInfo = useCallback(() => {
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    if (isMobile) {
      void loadChatDialogsModule();
      const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
      setInfoOpen(true);
      const mobileNav = getMobileNav?.() || {};
      if (!mobileHistoryReadyRef.current || typeof window === 'undefined' || !normalizedConversationId) return;
      const nextState = { view: 'thread', drawerOpen: false, infoOpen: true };
      const currentState = mobileNav.readMobileHistoryState?.();
      const currentConversationId = currentState?.view === 'thread'
        ? getCurrentBrowserConversationId?.()
        : '';
      const currentHistoryKey = currentState
        ? mobileNav.getMobileHistoryKey?.(currentState, currentConversationId)
        : '';
      const nextHistoryKey = mobileNav.getMobileHistoryKey?.(nextState, normalizedConversationId);
      if (currentHistoryKey === nextHistoryKey) return;
      mobileNav.writeMobileHistoryState?.(nextState, 'push', normalizedConversationId);
      return;
    }
    void loadChatContextPanelModule();
    const isTaskConversation = String(activeConversation?.kind || '').trim() === 'task'
      || Boolean(String(activeTaskConversationTaskId || '').trim());
    if (isTaskConversation) {
      if (disableTaskPanel) {
        openTaskFromChat(activeTaskConversationTaskId || activeConversation?.task_id);
        return;
      }
      setContextPanelOpen(false);
      setTaskPanelOpen((current) => {
        const next = !current;
        persistChatTaskPanelCollapsed(!next);
        return next;
      });
      if (!taskPanelOpen) void loadTaskWorkspacePanelModule();
      return;
    }
    setTaskPanelOpen(false);
    setContextPanelOpen((current) => !current);
  }, [
    activeConversation,
    activeConversationIdRef,
    activeTaskConversationTaskId,
    disableTaskPanel,
    getCurrentBrowserConversationId,
    getMobileNav,
    isMobile,
    loadChatDialogsModule,
    mobileHistoryReadyRef,
    openTaskFromChat,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
    taskPanelOpen,
  ]);

  const closeAllPanels = useCallback(() => {
    setInfoOpen(false);
    setContextPanelOpen(false);
    setTaskPanelOpen(false);
    setTaskPanelTaskId('');
  }, []);

  const closeInfoAndContextPanels = useCallback(() => {
    setInfoOpen(false);
    setContextPanelOpen(false);
  }, []);

  return {
    infoOpen,
    setInfoOpen,
    contextPanelOpen,
    setContextPanelOpen,
    taskPanelOpen,
    taskPanelTaskId,
    showContextPanel,
    showTaskPanel,
    renderDesktopRightPanel,
    renderPersistentRightPanel,
    contextPanelEnterDuration,
    contextPanelExitDuration,
    openTaskInTasks,
    openTaskFromChat,
    closeTaskPanel,
    handleTaskPanelUpdated,
    handleOpenInfo,
    closeMobileInfoView,
    closeAllPanels,
    closeInfoAndContextPanels,
  };
}
