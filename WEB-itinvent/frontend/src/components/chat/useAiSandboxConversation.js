import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAiSandboxAPI } from '../../api/chatAiSandbox';
import { chatDirectoryAPI } from '../../api/chatDirectory';
import { CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT } from '../../lib/chatSocket';

const normalizeSandboxPayload = (payload) => ({
  enabled: payload?.enabled !== false,
  session: payload?.session && typeof payload.session === 'object' ? payload.session : null,
  job: payload?.job && typeof payload.job === 'object' ? payload.job : null,
  files: Array.isArray(payload?.files) ? payload.files : [],
  diff: payload?.diff ?? [],
  pendingPermissions: Array.isArray(payload?.pending_permissions) ? payload.pending_permissions : [],
  archive: payload?.archive && typeof payload.archive === 'object' ? payload.archive : null,
});

const getAttachmentReference = (item) => ({
  messageId: String(item?.message_id || item?.messageId || item?.attachment?.message_id || '').trim(),
  attachmentId: String(
    item?.attachment_id
    || item?.attachmentId
    || item?.attachment?.id
    || '',
  ).trim(),
});

export default function useAiSandboxConversation({
  available = false,
  conversationId = '',
  refreshKey = '',
} = {}) {
  const requestSequenceRef = useRef(0);
  const [sandbox, setSandbox] = useState(() => normalizeSandboxPayload(null));
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!available || !normalizedConversationId) {
      setSandbox(normalizeSandboxPayload({ enabled: false }));
      setLoading(false);
      setError('');
      return null;
    }
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setLoading(true);
    setError('');
    try {
      const payload = await chatAiSandboxAPI.getConversation(normalizedConversationId);
      if (requestSequence !== requestSequenceRef.current) return null;
      const normalized = normalizeSandboxPayload(payload);
      setSandbox(normalized);
      return normalized;
    } catch (requestError) {
      if (requestSequence === requestSequenceRef.current) {
        if (Number(requestError?.response?.status || 0) === 404) {
          setSandbox(normalizeSandboxPayload({ enabled: false }));
          setError('');
        } else {
          setError('Не удалось загрузить состояние OpenCode workspace.');
        }
      }
      return null;
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [available, conversationId]);

  useEffect(() => {
    void load();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    if (!available || !String(conversationId || '').trim()) return undefined;
    const handleSandboxUpdate = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const updatedConversationId = String(
        envelope?.conversation_id
        || payload?.conversation_id
        || '',
      ).trim();
      if (updatedConversationId === String(conversationId).trim()) void load();
    };
    window.addEventListener(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, handleSandboxUpdate);
    return () => window.removeEventListener(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, handleSandboxUpdate);
  }, [available, conversationId, load]);

  const respondPermission = useCallback(async (permission, decision, scope = 'once') => {
    const permissionId = String(permission?.id || permission?.permission_id || '').trim();
    if (!permissionId) return false;
    const normalizedDecision = decision === 'allow' ? 'allow' : 'reject';
    const normalizedScope = scope === 'session' ? 'session' : 'once';
    setBusyKey(`permission:${permissionId}`);
    setError('');
    setNotice('');
    try {
      await chatAiSandboxAPI.respondPermission(permissionId, {
        decision: normalizedDecision,
        scope: normalizedScope,
      });
      setNotice(normalizedDecision === 'allow' ? 'Разрешение передано OpenCode.' : 'Действие отклонено.');
      await load();
      return true;
    } catch {
      setError('Не удалось ответить на запрос разрешения.');
      return false;
    } finally {
      setBusyKey('');
    }
  }, [load]);

  const attachFile = useCallback(async (file) => {
    const fileId = String(file?.id || file?.file_id || '').trim();
    if (!fileId) return null;
    setBusyKey(`attach:${fileId}`);
    setError('');
    setNotice('');
    try {
      const payload = await chatAiSandboxAPI.attachFile(fileId);
      setNotice('Файл прикреплён к чату.');
      await load();
      return payload;
    } catch {
      setError('Не удалось прикрепить файл к чату.');
      return null;
    } finally {
      setBusyKey('');
    }
  }, [load]);

  const attachArchive = useCallback(async () => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return null;
    setBusyKey('attach:archive');
    setError('');
    setNotice('');
    try {
      const payload = await chatAiSandboxAPI.attachArchive(normalizedConversationId);
      setNotice('Архив workspace прикреплён к чату.');
      await load();
      return payload;
    } catch {
      setError('Не удалось прикрепить архив workspace.');
      return null;
    } finally {
      setBusyKey('');
    }
  }, [conversationId, load]);

  const saveToMyFiles = useCallback(async (item, itemKind = 'file') => {
    const { messageId, attachmentId } = getAttachmentReference(item);
    if (!messageId || !attachmentId) return null;
    const itemId = String(item?.id || item?.file_id || attachmentId).trim();
    setBusyKey(`save:${itemId}`);
    setError('');
    setNotice('');
    try {
      const payload = await chatDirectoryAPI.saveAttachmentToMyFiles(messageId, attachmentId);
      setNotice(itemKind === 'archive'
        ? 'Архив отправлен на проверку и сохранение в «Мои файлы».'
        : 'Файл отправлен на проверку и сохранение в «Мои файлы».');
      return payload;
    } catch {
      setError('Не удалось сохранить файл в «Мои файлы».');
      return null;
    } finally {
      setBusyKey('');
    }
  }, []);

  return {
    ...sandbox,
    loading,
    busyKey,
    error,
    notice,
    load,
    respondPermission,
    attachFile,
    attachArchive,
    saveToMyFiles,
    dismissNotice: () => setNotice(''),
  };
}
