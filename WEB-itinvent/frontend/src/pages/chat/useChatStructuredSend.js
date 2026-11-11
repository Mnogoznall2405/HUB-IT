import { useCallback, useState } from 'react';

import { chatAPI } from '../../api/client';
import { CHAT_POLL_MAX_OPTIONS, CHAT_POLL_MIN_OPTIONS } from '../../components/chat/chatHelpers';

export { CHAT_POLL_MAX_OPTIONS, CHAT_POLL_MIN_OPTIONS };

const GEOLOCATION_TIMEOUT_MS = 15000;
const GEOLOCATION_MAX_AGE_MS = 60000;

// C9: structured messages share the regular send endpoint; `kind` tells the
// backend which canonical JSON shape the body carries.
export default function useChatStructuredSend({
  activeConversationId,
  applyOutgoingThreadMessage,
  ensureLatestThreadWindow,
  notifyApiError,
  notifyWarning,
  setComposerMenuAnchor,
}) {
  const [structuredDialog, setStructuredDialog] = useState(null);
  const [locationSending, setLocationSending] = useState(false);
  // R13: resolved coordinates wait for an explicit confirmation — a stray
  // menu click must never leak the user's position.
  const [locationDraft, setLocationDraft] = useState(null);

  const closeStructuredDialog = useCallback(() => {
    setStructuredDialog(null);
    setLocationDraft(null);
  }, []);

  const openPollDialog = useCallback(() => {
    if (!activeConversationId) return;
    setComposerMenuAnchor?.(null);
    setStructuredDialog('poll');
  }, [activeConversationId, setComposerMenuAnchor]);

  const openContactDialog = useCallback(() => {
    if (!activeConversationId) return;
    setComposerMenuAnchor?.(null);
    setStructuredDialog('contact');
  }, [activeConversationId, setComposerMenuAnchor]);

  const sendStructuredMessage = useCallback(async (kind, payload) => {
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || !payload) return false;
    const clientMessageId = globalThis.crypto?.randomUUID?.()
      || `structured-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // R20: structured sends also drain the newer window first — the resulting
    // bubble must not sit above an unloaded tail.
    await ensureLatestThreadWindow?.();
    try {
      const message = await chatAPI.sendMessage(conversationId, JSON.stringify(payload), {
        kind,
        client_message_id: clientMessageId,
      });
      // R14: own structured sends keep the same always-scroll-to-bottom rule
      // as text/file/sticker sends.
      if (message?.id) applyOutgoingThreadMessage(conversationId, message, {
        scroll: true,
        scrollSource: 'sendStructured',
      });
      return true;
    } catch (error) {
      notifyApiError(error, 'Не удалось отправить сообщение.');
      return false;
    }
  }, [activeConversationId, applyOutgoingThreadMessage, ensureLatestThreadWindow, notifyApiError]);

  const sendPollMessage = useCallback(async ({ question, options, anonymous }) => {
    const normalizedOptions = (Array.isArray(options) ? options : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, CHAT_POLL_MAX_OPTIONS);
    const trimmedQuestion = String(question || '').trim();
    if (!trimmedQuestion || normalizedOptions.length < CHAT_POLL_MIN_OPTIONS) return false;
    const sent = await sendStructuredMessage('poll', {
      question: trimmedQuestion,
      options: normalizedOptions,
      anonymous: Boolean(anonymous),
    });
    if (sent) setStructuredDialog(null);
    return sent;
  }, [sendStructuredMessage]);

  const sendContactMessage = useCallback(async ({ name, phone, organization }) => {
    const payload = { name: String(name || '').trim() };
    if (!payload.name) return false;
    const normalizedPhone = String(phone || '').trim();
    const normalizedOrganization = String(organization || '').trim();
    if (normalizedPhone) payload.phone = normalizedPhone;
    if (normalizedOrganization) payload.organization = normalizedOrganization;
    const sent = await sendStructuredMessage('contact', payload);
    if (sent) setStructuredDialog(null);
    return sent;
  }, [sendStructuredMessage]);

  const sendLocationMessage = useCallback(async () => {
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || locationSending) return false;
    setComposerMenuAnchor?.(null);
    const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      notifyWarning?.('Геопозиция недоступна в этом браузере.');
      return false;
    }
    setLocationSending(true);
    try {
      const position = await new Promise((resolve, reject) => {
        geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: GEOLOCATION_TIMEOUT_MS,
          maximumAge: GEOLOCATION_MAX_AGE_MS,
        });
      });
      setLocationDraft({
        latitude: Number(position?.coords?.latitude),
        longitude: Number(position?.coords?.longitude),
        accuracy: Number(position?.coords?.accuracy),
      });
      setStructuredDialog('location');
      return true;
    } catch (error) {
      const denied = Number(error?.code) === 1;
      notifyWarning?.(denied
        ? 'Нет доступа к геопозиции. Разрешите определение местоположения в настройках браузера.'
        : 'Не удалось определить местоположение. Повторите попытку.');
      return false;
    } finally {
      setLocationSending(false);
    }
  }, [
    activeConversationId,
    locationSending,
    notifyWarning,
    setComposerMenuAnchor,
  ]);

  const confirmLocationMessage = useCallback(async () => {
    if (!locationDraft) return false;
    const sent = await sendStructuredMessage('location', {
      latitude: locationDraft.latitude,
      longitude: locationDraft.longitude,
    });
    if (sent) closeStructuredDialog();
    return sent;
  }, [closeStructuredDialog, locationDraft, sendStructuredMessage]);

  return {
    closeStructuredDialog,
    confirmLocationMessage,
    locationDraft,
    locationSending,
    openContactDialog,
    openPollDialog,
    sendContactMessage,
    sendLocationMessage,
    sendPollMessage,
    structuredDialog,
  };
}
