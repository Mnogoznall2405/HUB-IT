import { useEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';
import {
  clearChatComposePrefill,
  isChatComposePrefillRoute,
  readChatComposePrefill,
} from '../../lib/chatComposePrefill';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';

export function stripComposePrefillSearch(search = '') {
  const searchParams = new URLSearchParams(String(search || ''));
  searchParams.delete('compose');
  const nextSearch = searchParams.toString();
  return nextSearch ? `?${nextSearch}` : '';
}

export function resolveComposePrefillConversationId(created, items = []) {
  const createdId = String(created?.id || '');
  return items.find((item) => item.id === createdId)?.id || createdId || '';
}

export function shouldHandleComposePrefillRoute({
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
  locationSearch = '',
  handled = false,
} = {}) {
  if (!chatFeatureEnabled) return false;
  if (!isChatComposePrefillRoute(locationSearch)) return false;
  return !handled;
}

export async function bootstrapComposePrefill({
  locationSearch,
  navigate,
  readPrefill = readChatComposePrefill,
  clearPrefill = clearChatComposePrefill,
  createDirectConversation = chatAPI.createDirectConversation.bind(chatAPI),
  resetSidebarSearch,
  loadConversations,
  shareComposeDraftRef,
  openConversation,
  focusComposer,
  notifyApiError,
  setTimeoutFn = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout.bind(window)
    : undefined,
} = {}) {
  const stripComposeFromUrl = () => {
    navigate({ pathname: '/chat', search: stripComposePrefillSearch(locationSearch) }, { replace: true });
  };

  const prefill = readPrefill();
  if (!prefill?.peerUserId || !prefill.bodyText) {
    clearPrefill();
    stripComposeFromUrl();
    return;
  }

  const peerId = Number(prefill.peerUserId);
  const bodyText = String(prefill.bodyText || '');

  try {
    const created = await createDirectConversation(peerId);
    resetSidebarSearch();
    const items = await loadConversations({ silent: true, force: true });
    const nextConversationId = resolveComposePrefillConversationId(created, items);
    if (nextConversationId) {
      shareComposeDraftRef.current = {
        conversationId: nextConversationId,
        bodyText,
      };
      openConversation(nextConversationId);
      setTimeoutFn?.(() => {
        focusComposer();
      }, 0);
    }
  } catch (error) {
    notifyApiError(error, 'Не удалось открыть чат для отправки файла.');
  } finally {
    clearPrefill();
    stripComposeFromUrl();
  }
}

export default function useChatComposePrefillBootstrap({
  focusComposer,
  loadConversations,
  locationSearch,
  navigate,
  notifyApiError,
  openConversation,
  resetSidebarSearch,
  shareComposeDraftRef,
}) {
  const shareComposePrefillHandledRef = useRef(false);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED) return;
    if (!isChatComposePrefillRoute(locationSearch)) {
      shareComposePrefillHandledRef.current = false;
      return;
    }
    if (shareComposePrefillHandledRef.current) return;
    shareComposePrefillHandledRef.current = true;

    void bootstrapComposePrefill({
      locationSearch,
      navigate,
      resetSidebarSearch,
      loadConversations,
      shareComposeDraftRef,
      openConversation,
      focusComposer,
      notifyApiError,
    });
  }, [
    focusComposer,
    loadConversations,
    locationSearch,
    navigate,
    notifyApiError,
    openConversation,
    resetSidebarSearch,
    shareComposeDraftRef,
  ]);
}
