import { useCallback, useState } from 'react';

import { chatAPI } from '../../api/client';
import { sortSidebarConversations } from '../../components/chat/chatHelpers';
import {
  getTaskConversationTaskId,
  isOrphanedTaskConversation,
  getConversationRemovalMode,
} from './chatConversationModel';

export default function useChatConversationActionsController({
  activeConversationId,
  handleRemoteConversationRemoved,
  notifyApiError,
  notifyInfo,
  setConversations,
  upsertSearchConversation,
}) {
  const [conversationActionTarget, setConversationActionTarget] = useState(null);
  const [conversationActionPendingId, setConversationActionPendingId] = useState('');
  const [settingsUpdating, setSettingsUpdating] = useState(false);

  const updateConversationSettings = useCallback(async (conversationOrPayload, maybePayload) => {
    const conversationId = String(typeof conversationOrPayload === 'string' ? conversationOrPayload : activeConversationId || '').trim();
    const payload = typeof conversationOrPayload === 'string' ? maybePayload : conversationOrPayload;
    if (!conversationId || !payload || typeof payload !== 'object') return;
    setSettingsUpdating(true);
    try {
      const updated = await chatAPI.updateConversationSettings(conversationId, payload);
      setConversations((current) => {
        const next = current.map((item) => (item.id === updated.id ? updated : item));
        return sortSidebarConversations(next);
      });
      upsertSearchConversation(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить настройки чата.');
    } finally {
      setSettingsUpdating(false);
    }
  }, [activeConversationId, notifyApiError, setConversations, upsertSearchConversation]);

  const requestDeleteConversation = useCallback((conversation) => {
    const conversationId = String(conversation?.id || '').trim();
    if (!conversationId) return;
    const kind = String(conversation?.kind || '').trim();
    if ((kind === 'task' || getTaskConversationTaskId(conversation)) && !isOrphanedTaskConversation(conversation)) {
      notifyInfo('Чат задачи удаляется только вместе с самой задачей.', { title: 'Чат задачи' });
      return;
    }
    setConversationActionTarget({
      mode: 'delete',
      conversation,
    });
  }, [notifyInfo]);

  const renameAiConversation = useCallback(async (conversationId, title) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedTitle = String(title || '').trim();
    if (!normalizedConversationId || !normalizedTitle) return null;
    setConversationActionPendingId(normalizedConversationId);
    try {
      const updated = await chatAPI.renameAiConversation(normalizedConversationId, normalizedTitle);
      setConversations((current) => {
        const next = current.map((item) => (item.id === updated.id ? updated : item));
        return sortSidebarConversations(next);
      });
      upsertSearchConversation(updated);
      return updated;
    } catch (error) {
      notifyApiError(error, 'Не удалось переименовать AI-диалог.');
      return null;
    } finally {
      setConversationActionPendingId('');
    }
  }, [notifyApiError, setConversations, upsertSearchConversation]);

  const requestLeaveConversation = useCallback((conversation) => {
    const conversationId = String(conversation?.id || '').trim();
    if (!conversationId) return;
    setConversationActionTarget({
      mode: 'leave',
      conversation,
    });
  }, []);

  const requestConversationRemoval = useCallback((conversation) => {
    if (getConversationRemovalMode(conversation) === 'leave') {
      requestLeaveConversation(conversation);
      return;
    }
    requestDeleteConversation(conversation);
  }, [requestDeleteConversation, requestLeaveConversation]);

  const confirmConversationAction = useCallback(async () => {
    const target = conversationActionTarget;
    const conversation = target?.conversation;
    const conversationId = String(conversation?.id || '').trim();
    if (!conversationId || !target?.mode) return;
    setConversationActionPendingId(conversationId);
    try {
      if (target.mode === 'leave') {
        await chatAPI.leaveGroup(conversationId);
      } else if (String(conversation?.kind || '').trim() === 'ai') {
        await chatAPI.deleteAiConversation(conversationId);
      } else {
        await chatAPI.deleteConversation(conversationId);
      }
      handleRemoteConversationRemoved(conversationId);
      setConversationActionTarget(null);
    } catch (error) {
      notifyApiError(
        error,
        target.mode === 'leave'
          ? 'Не удалось выйти из группы.'
          : 'Не удалось удалить чат.',
      );
    } finally {
      setConversationActionPendingId('');
    }
  }, [conversationActionTarget, handleRemoteConversationRemoved, notifyApiError]);

  const closeConversationAction = useCallback(() => {
    setConversationActionTarget(null);
  }, []);

  const conversationActionConversation = conversationActionTarget?.conversation || null;
  const conversationActionId = String(conversationActionConversation?.id || '').trim();
  const conversationActionIsLeave = conversationActionTarget?.mode === 'leave';
  const conversationActionTitle = String(
    conversationActionConversation?.task_title
    || conversationActionConversation?.title
    || 'Этот чат',
  ).trim();

  return {
    closeConversationAction,
    confirmConversationAction,
    conversationActionConversation,
    conversationActionId,
    conversationActionIsLeave,
    conversationActionPendingId,
    conversationActionTarget,
    conversationActionTitle,
    requestConversationRemoval,
    requestDeleteConversation,
    requestLeaveConversation,
    renameAiConversation,
    settingsUpdating,
    updateConversationSettings,
  };
}
