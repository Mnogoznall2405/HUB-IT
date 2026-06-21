import { Suspense, lazy, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { emitAgentDebugLog } from '../lib/debugClientLog';
import { chatAPI, mailAPI } from '../api/client';
import chatAttachmentsAPI from '../api/chatAttachments';
import chatFoldersAPI from '../api/chatFolders';
import ChatFolderDialogs from '../components/chat/ChatFolderDialogs';
import ChatSidebar from '../components/chat/ChatSidebar';
import ChatThread from '../components/chat/ChatThread';
import {
  summarizePreparedChatUploadItems,
} from '../components/chat/chatUploadPrep';
import {
  CHAT_FILE_ACCEPT,
  applyReadReceiptDeltaToMessages,
  buildAttachmentUrl,
  buildChatDraftKey,
  buildChatPinnedMessageKey,
  countUnreadIncomingAfterMarker,
  getConversationHeaderSubtitle,
  getMessagePreview,
  getUnreadAnchorId,
  isImageAttachment,
  isMediaAttachment,
  isVideoAttachment,
  normalizeChatAttachmentUrl,
  pickBlobAttachmentUrl,
  resolveLatestMessageIdInOrder,
  sortSidebarConversations,
} from '../components/chat/chatHelpers';
import {
  buildChatDocumentPreviewState,
  isChatDocumentPreviewableAttachment,
  mapChatAttachmentForPreview,
} from '../components/chat/chatAttachmentPreview';
import useReadReceipts from '../components/chat/useReadReceipts';
import useChatActiveThreadPolling from '../components/chat/useChatActiveThreadPolling';
import useChatAiStatusPolling from '../components/chat/useChatAiStatusPolling';
import useChatComposerSending from '../components/chat/useChatComposerSending';
import useChatFileSending from '../components/chat/useChatFileSending';
import useVoiceRecorder from '../components/chat/useVoiceRecorder';
import useChatForwardMessages from '../components/chat/useChatForwardMessages';
import useChatGroupDialog from '../components/chat/useChatGroupDialog';
import useChatMessageMenuActions from '../components/chat/useChatMessageMenuActions';
import useChatMessageSearch from '../components/chat/useChatMessageSearch';
import useChatSelectedMessageActions from '../components/chat/useChatSelectedMessageActions';
import useChatSidebarSearch from '../components/chat/useChatSidebarSearch';
import {
  buildConversationIdsByFolder,
  buildFolderUnreadCounts,
  filterSidebarConversationsByFolder,
  readStoredActiveFolderKey,
  writeStoredActiveFolderKey,
} from '../components/chat/chatFolderUtils';
import useChatSocketEvents from '../components/chat/useChatSocketEvents';
import useChatSocketLifecycle from '../components/chat/useChatSocketLifecycle';
import useChatTaskShareDialog from '../components/chat/useChatTaskShareDialog';
import useChatTaskSharing from '../components/chat/useChatTaskSharing';
import useChatThreadViewport from '../components/chat/useChatThreadViewport';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { useMainLayoutShell } from '../components/layout/MainLayoutShellContext';
import { sanitizeMailHtmlFragment } from '../components/mail/mailHtmlContent';
import {
  buildAttachmentBlobPayload,
  createEmptyAttachmentPreview,
  downloadBlobFile,
} from '../components/mail/mailMessageFileActions';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  clearChatComposePrefill,
  isChatComposePrefillRoute,
  readChatComposePrefill,
} from '../lib/chatComposePrefill';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../lib/chatFeature';
import { isNativeShellRuntime } from '../lib/platform';
import { getOrFetchSWR, invalidateSWRCacheByPrefix, peekSWRCache, setSWRCache } from '../lib/swrCache';
import { chatSocket } from '../lib/chatSocket';
import { buildChatUiTokens } from '../components/chat/chatUiTokens';

const loadChatContextPanelModule = () => import('../components/chat/ChatContextPanel');
const loadChatDialogsModule = () => import('../components/chat/ChatDialogs');
const LazyChatContextPanel = lazy(loadChatContextPanelModule);
const LazyChatDialogs = lazy(loadChatDialogsModule);

const LIST_POLL_MS = 15_000;
const THREAD_POLL_MS = 6_000;
const ACTIVE_THREAD_INCREMENTAL_POLL_MS = 1_000;
const AI_ACTIVE_POLL_MS = 1_000;
const AI_ACTIVE_POLL_WS_CONNECTED_MS = 10_000;
const ACTIVE_THREAD_SOCKET_STALE_MS = 60_000;
// Coalesce window for the public socket-activity timestamp. The transport
// freshness state only needs to flip within ACTIVE_THREAD_SOCKET_STALE_MS, so
// we avoid a re-render of this large component on every inbound frame/pong and
// instead publish at most one update per window (the ref stays exact).
const SOCKET_ACTIVITY_COALESCE_MS = 10_000;
const SEARCH_MS = 250;
const CHAT_DEBUG_STORAGE_KEY = 'chat:debug';
const CHAT_SCROLL_DEBUG_STORAGE_KEY = 'chat:scroll-debug';
const CONTEXT_PANEL_ENTER_MS = 220;
const CONTEXT_PANEL_EXIT_MS = 180;
const FIRST_UNREAD_TOP_PADDING = 14;
const INITIAL_THREAD_POSITION_SETTLE_MS = 1_200;
const INITIAL_THREAD_POSITION_MAX_MS = 6_000;
const INITIAL_THREAD_AUTOSCROLL_GUARD_MS = 500;
const INITIAL_THREAD_SCROLL_TRACE_WINDOW_MS = 200;
const OUTGOING_BOTTOM_SETTLE_FRAMES = 2;
const ACTIVE_THREAD_REVALIDATE_DEDUP_MS = 2_500;
const CHAT_SWR_STALE_TIME_MS = 30_000;
const CHAT_THREAD_BOOTSTRAP_LIMIT = 40;
export const isChatLayoutKeyboardOpen = (container) => {
  const layoutHeight = Math.round(Number(window.innerHeight || document.documentElement?.clientHeight || 0));
  const clientHeight = Math.round(Number(container?.clientHeight || 0));
  if (clientHeight <= 0 || layoutHeight <= 0) return false;
  return (layoutHeight - clientHeight) > 180;
};

export const getChatBottomInstantSettleFrames = ({
  userInitiated = false,
  mobileKeyboardDeferred = false,
} = {}) => {
  if (mobileKeyboardDeferred) return userInitiated ? 4 : 3;
  return userInitiated ? OUTGOING_BOTTOM_SETTLE_FRAMES : 1;
};
export const buildChatConversationsCacheKeyParts = (userId) => ['chat', 'conversations', String(userId || 'guest')];
export const buildChatAiBotsCacheKeyParts = (userId) => ['chat', 'ai-bots', String(userId || 'guest')];
export const buildChatThreadCacheKeyParts = (userId, conversationId) => ['chat', 'thread', String(userId || 'guest'), String(conversationId || '').trim(), 'latest'];
export const buildChatLastConversationSessionKey = (userId) => `chat:last-conversation:${String(userId || 'guest')}`;
export const buildChatLastMobileViewSessionKey = (userId) => `chat:last-mobile-view:${String(userId || 'guest')}`;
export const shouldDeferChatUrlSyncForRequestedConversation = ({
  applyingRequestedConversationId,
  activeConversationId,
}) => {
  const applyingId = String(applyingRequestedConversationId || '').trim();
  if (!applyingId) return false;
  return String(activeConversationId || '').trim() !== applyingId;
};
const CHAT_MOBILE_HISTORY_FLAG = '__hubChatMobileShell';
const CHAT_MOBILE_HISTORY_VIEW_KEY = '__hubChatMobileShellView';
const CHAT_MOBILE_HISTORY_DRAWER_KEY = '__hubChatMobileShellDrawer';
const CHAT_MOBILE_HISTORY_INFO_KEY = '__hubChatMobileShellInfo';

export const CHAT_MOBILE_SCREEN_TRANSITION_MS = 320;
const CHAT_MOBILE_SCREEN_PARALLAX_RATIO = 0.12;
export const CHAT_MOBILE_SCREEN_TRANSITION_EASE = [0.25, 0.1, 0.25, 1];

export const buildChatMobileScreenVariants = ({ motionDisabled = false } = {}) => ({
  enter: (direction) => ({
    x: motionDisabled ? 0 : (direction > 0 ? '100%' : `-${CHAT_MOBILE_SCREEN_PARALLAX_RATIO * 100}%`),
    opacity: 1,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: motionDisabled ? 0 : (direction > 0 ? `-${CHAT_MOBILE_SCREEN_PARALLAX_RATIO * 100}%` : '100%'),
    opacity: 1,
  }),
});

export function resolveChatMobileBottomNavMode(isMobile, hideBottomNav) {
  return isMobile && hideBottomNav ? 'hidden' : 'auto';
}

export function readChatMobileHistoryState(state) {
  if (!state || typeof state !== 'object' || state[CHAT_MOBILE_HISTORY_FLAG] !== true) return null;
  const nextView = String(state[CHAT_MOBILE_HISTORY_VIEW_KEY] || '').trim() === 'thread' ? 'thread' : 'inbox';
  return {
    view: nextView,
    drawerOpen: false,
    infoOpen: nextView === 'thread' && Boolean(state[CHAT_MOBILE_HISTORY_INFO_KEY]),
  };
}

export const canUseAiChatPermission = (hasPermission) => (
  typeof hasPermission === 'function' ? Boolean(hasPermission('chat.ai.use')) : false
);

export const shouldRequestConversationAiStatus = ({
  conversationId,
  conversationKind,
  canUseAiChat,
}) => (
  Boolean(canUseAiChat)
  && String(conversationId || '').trim().length > 0
  && String(conversationKind || '').trim() === 'ai'
);

export const mergeAiStatusPayload = (current, payload, fallbackConversationId = '') => {
  const nextCurrent = current && typeof current === 'object' ? current : {};
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const conversationId = String(
    nextPayload.conversation_id
    || fallbackConversationId
    || ''
  ).trim();
  if (!conversationId) return nextCurrent;
  return {
    ...nextCurrent,
    [conversationId]: nextPayload,
  };
};

export const resolveActiveAiBotRecord = ({
  aiBots,
  activeConversationId,
  aiStatus,
}) => {
  const items = Array.isArray(aiBots) ? aiBots : [];
  const normalizedConversationId = String(activeConversationId || '').trim();
  const normalizedBotId = String(aiStatus?.bot_id || '').trim();
  return items.find((item) => String(item?.conversation_id || '').trim() === normalizedConversationId)
    || items.find((item) => normalizedBotId && String(item?.id || '').trim() === normalizedBotId)
    || null;
};

export const buildAiLiveDataNotice = ({
  activeConversationKind,
  activeConversationId,
  aiStatus,
  aiBots,
}) => {
  void activeConversationKind;
  void activeConversationId;
  void aiStatus;
  void aiBots;
  return null;
};
const AI_STATUS_FALLBACK_TEXTS = {
  queued: 'Запрос принят. Ставлю задачу в очередь.',
  analyzing_request: 'Анализирую ваш запрос.',
  reading_files: 'Изучаю вложенные файлы и контекст.',
  retrieving_kb: 'Проверяю базу знаний и документы.',
  checking_itinvent: 'Проверяю данные ITinvent.',
  checking_ad: 'Проверяю данные Active Directory.',
  searching_equipment: 'Ищу оборудование.',
  opening_equipment_card: 'Открываю карточку устройства.',
  generating_answer: 'Формирую ответ.',
  generating_files: 'Подготавливаю итоговые файлы.',
  failed: 'Не удалось обработать запрос.',
};

export const buildAiStatusDisplayModel = (aiStatus) => {
  const payload = aiStatus && typeof aiStatus === 'object' ? aiStatus : {};
  const status = String(payload?.status || '').trim();
  const stage = String(payload?.stage || '').trim();
  const explicitText = String(payload?.status_text || '').trim();
  const fallbackText = explicitText
    || AI_STATUS_FALLBACK_TEXTS[stage]
    || AI_STATUS_FALLBACK_TEXTS[status]
    || '';
  const isVisible = Boolean(status) && status !== 'completed' && Boolean(fallbackText || status === 'failed');
  return {
    visible: isVisible,
    tone: status === 'failed' ? 'error' : 'info',
    primaryText: fallbackText,
    secondaryText: status === 'failed' ? String(payload?.error_text || '').trim() : '',
    showSpinner: status === 'queued' || status === 'running',
    status,
    stage,
  };
};

export const shouldPollActiveAiThread = ({
  activeConversationId,
  activeConversationKind,
  aiStatus,
  canUseAiChat,
  transportState = '',
  socketStatus,
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !conversationId || !canUseAiChat) return false;
  if (String(activeConversationKind || '').trim() !== 'ai') return false;
  const normalizedStatus = String(aiStatus?.status || '').trim();
  if (normalizedStatus === 'queued' || normalizedStatus === 'running') return true;
  const normalizedTransportState = String(transportState || '').trim();
  if (normalizedTransportState) return normalizedTransportState !== 'healthy';
  if (!chatWsEnabled) return false;
  return String(socketStatus || '').trim() !== 'connected';
};

const splitMailRecipients = (value) => (
  String(value || '')
    .split(/[;,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
);

const joinMailRecipients = (value) => (
  Array.isArray(value) ? value.filter(Boolean).join('; ') : ''
);

const normalizeMailAttachmentRefs = (value) => (
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      message_id: String(item?.message_id || '').trim(),
      attachment_id: String(item?.attachment_id || item?.id || '').trim(),
      file_name: String(item?.file_name || item?.name || '').trim(),
      size: Number(item?.size || item?.file_size || 0) || 0,
    }))
    .filter((item) => item.message_id && item.attachment_id)
);

function AiMailActionEditDialog({
  open,
  actionCard,
  availableAttachments = [],
  onClose,
  onSubmit,
}) {
  const preview = actionCard?.preview && typeof actionCard.preview === 'object' ? actionCard.preview : {};
  const mail = preview.mail && typeof preview.mail === 'object' ? preview.mail : {};
  const [draft, setDraft] = useState(() => ({
    mailbox_id: String(mail.mailbox_id || ''),
    to: joinMailRecipients(mail.to),
    cc: joinMailRecipients(mail.cc),
    bcc: joinMailRecipients(mail.bcc),
    subject: String(mail.subject || ''),
    body: String(mail.body || mail.body_preview || ''),
    attachment_refs: normalizeMailAttachmentRefs(mail.attachment_refs),
  }));
  const [signatureHtml, setSignatureHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft({
      mailbox_id: String(mail.mailbox_id || ''),
      to: joinMailRecipients(mail.to),
      cc: joinMailRecipients(mail.cc),
      bcc: joinMailRecipients(mail.bcc),
      subject: String(mail.subject || ''),
      body: String(mail.body || mail.body_preview || ''),
      attachment_refs: normalizeMailAttachmentRefs(mail.attachment_refs),
    });
    setErrorText('');
  }, [open, mail.body, mail.body_preview, mail.mailbox_id, mail.subject]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    mailAPI.getMyConfig({ mailbox_id: draft.mailbox_id || undefined })
      .then((config) => {
        if (!cancelled) setSignatureHtml(String(config?.mail_signature_html || ''));
      })
      .catch(() => {
        if (!cancelled) setSignatureHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.mailbox_id]);

  const selectedAttachmentKeys = useMemo(() => (
    new Set(normalizeMailAttachmentRefs(draft.attachment_refs).map((item) => `${item.message_id}:${item.attachment_id}`))
  ), [draft.attachment_refs]);
  const safeSignatureHtml = useMemo(() => sanitizeMailHtmlFragment(signatureHtml), [signatureHtml]);

  const toggleAttachment = (attachment) => {
    const ref = {
      message_id: String(attachment?.message_id || '').trim(),
      attachment_id: String(attachment?.attachment_id || attachment?.id || '').trim(),
      file_name: String(attachment?.file_name || '').trim(),
      size: Number(attachment?.file_size || attachment?.size || 0) || 0,
    };
    if (!ref.message_id || !ref.attachment_id) return;
    const key = `${ref.message_id}:${ref.attachment_id}`;
    setDraft((current) => {
      const currentRefs = normalizeMailAttachmentRefs(current.attachment_refs);
      const exists = currentRefs.some((item) => `${item.message_id}:${item.attachment_id}` === key);
      return {
        ...current,
        attachment_refs: exists
          ? currentRefs.filter((item) => `${item.message_id}:${item.attachment_id}` !== key)
          : [...currentRefs, ref].slice(0, 10),
      };
    });
  };

  const handleSubmit = async () => {
    const payload = {
      mailbox_id: draft.mailbox_id,
      to: splitMailRecipients(draft.to),
      cc: splitMailRecipients(draft.cc),
      bcc: splitMailRecipients(draft.bcc),
      subject: String(draft.subject || ''),
      body: String(draft.body || ''),
      is_html: true,
      attachment_refs: normalizeMailAttachmentRefs(draft.attachment_refs),
    };
    if (mail.reply_to_message_id) payload.reply_to_message_id = String(mail.reply_to_message_id || '');
    if (payload.to.length === 0) {
      setErrorText('Укажите хотя бы одного получателя.');
      return;
    }
    if (!payload.body.trim()) {
      setErrorText('Текст письма не должен быть пустым.');
      return;
    }
    setSending(true);
    setErrorText('');
    try {
      await onSubmit?.(payload);
    } catch (error) {
      setErrorText(error?.response?.data?.detail || error?.message || 'Не удалось отправить письмо.');
      setSending(false);
      return;
    }
    setSending(false);
  };

  return (
    <Dialog open={Boolean(open)} onClose={sending ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Редактировать письмо</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.4} sx={{ pt: 0.5 }}>
          {errorText ? <Alert severity="error">{errorText}</Alert> : null}
          <TextField size="small" label="Mailbox" value={draft.mailbox_id} onChange={(event) => setDraft((current) => ({ ...current, mailbox_id: event.target.value }))} fullWidth />
          <TextField size="small" label="Кому" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} fullWidth />
          <TextField size="small" label="Копия" value={draft.cc} onChange={(event) => setDraft((current) => ({ ...current, cc: event.target.value }))} fullWidth />
          <TextField size="small" label="Скрытая копия" value={draft.bcc} onChange={(event) => setDraft((current) => ({ ...current, bcc: event.target.value }))} fullWidth />
          <TextField size="small" label="Тема" value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} fullWidth />
          <TextField label="Текст" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} fullWidth multiline minRows={7} />
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.5 }}>Вложения из чата</Typography>
            {availableAttachments.length > 0 ? (
              <Stack spacing={0.2}>
                {availableAttachments.slice(0, 30).map((attachment) => {
                  const key = `${attachment.message_id}:${attachment.attachment_id}`;
                  return (
                    <FormControlLabel
                      key={key}
                      control={<Checkbox size="small" checked={selectedAttachmentKeys.has(key)} onChange={() => toggleAttachment(attachment)} />}
                      label={`${attachment.file_name || 'Файл'}${attachment.file_size ? ` · ${attachment.file_size} байт` : ''}`}
                    />
                  );
                })}
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>В этой беседе нет файлов для вложения.</Typography>
            )}
          </Box>
          <Alert severity="info">Подпись будет добавлена автоматически при отправке.</Alert>
          {safeSignatureHtml ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, mb: 0.5, color: 'text.secondary' }}>Подпись</Typography>
              <Box sx={{ fontSize: 13, '& img': { maxWidth: '100%' } }} dangerouslySetInnerHTML={{ __html: safeSignatureHtml }} />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending} sx={{ textTransform: 'none' }}>Отмена</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={sending} sx={{ textTransform: 'none' }}>
          {sending ? 'Отправляю...' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export const resolveActiveThreadTransportState = ({
  activeConversationId,
  socketStatus,
  lastSocketActivityAt = 0,
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
  staleAfterMs = ACTIVE_THREAD_SOCKET_STALE_MS,
  now = Date.now(),
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !chatWsEnabled || !conversationId) return 'offline';
  const normalizedSocketStatus = String(socketStatus || '').trim();
  if (normalizedSocketStatus === 'connected') {
    const activityAt = Number(lastSocketActivityAt || 0);
    if (!Number.isFinite(activityAt) || activityAt <= 0) return 'degraded';
    return (Number(now) - activityAt) <= Number(staleAfterMs || ACTIVE_THREAD_SOCKET_STALE_MS) ? 'healthy' : 'degraded';
  }
  if (normalizedSocketStatus === 'connecting' || normalizedSocketStatus === 'reconnecting') return 'degraded';
  return 'offline';
};

export const shouldPollActiveThreadIncrementally = ({
  activeConversationId,
  transportState = '',
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !chatWsEnabled || !conversationId) return false;
  return String(transportState || '').trim() !== 'healthy';
};

const isOptimisticThreadMessageId = (messageId) => String(messageId || '').trim().startsWith('optimistic:');

const normalizeThreadMessageId = (message) => String(message?.id || '').trim();

const normalizeThreadMessageClientId = (message) => String(message?.client_message_id || '').trim();

const buildThreadMessageSignature = (message) => {
  if (!message || typeof message !== 'object') return '';
  const sender = message?.sender || {};
  const replyPreview = message?.reply_preview || {};
  const taskPreview = message?.task_preview || {};
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return JSON.stringify({
    id: normalizeThreadMessageId(message),
    conversation_id: String(message?.conversation_id || '').trim(),
    client_message_id: normalizeThreadMessageClientId(message),
    kind: String(message?.kind || '').trim(),
    body_format: String(message?.body_format || '').trim(),
    body: String(message?.body || ''),
    created_at: String(message?.created_at || '').trim(),
    edited_at: String(message?.edited_at || '').trim(),
    delivery_status: String(message?.delivery_status || '').trim(),
    read_by_count: Number(message?.read_by_count || 0),
    is_own: Boolean(message?.is_own),
    isOptimistic: Boolean(message?.isOptimistic),
    optimisticStatus: String(message?.optimisticStatus || '').trim(),
    uploadProgress: Number(message?.uploadProgress || 0),
    renderKey: String(message?.renderKey || message?.render_key || '').trim(),
    sender: {
      id: String(sender?.id || '').trim(),
      username: String(sender?.username || '').trim(),
      full_name: String(sender?.full_name || '').trim(),
    },
    reply_preview: {
      id: String(replyPreview?.id || '').trim(),
      kind: String(replyPreview?.kind || '').trim(),
      body: String(replyPreview?.body || '').trim(),
      task_title: String(replyPreview?.task_title || '').trim(),
      attachments_count: Number(replyPreview?.attachments_count || 0),
    },
    task_preview: {
      id: String(taskPreview?.id || '').trim(),
      title: String(taskPreview?.title || '').trim(),
      status: String(taskPreview?.status || '').trim(),
    },
    attachments: attachments.map((attachment) => ({
      id: String(attachment?.id || '').trim(),
      file_name: String(attachment?.file_name || '').trim(),
      file_size: Number(attachment?.file_size || 0),
      mime_type: String(attachment?.mime_type || '').trim(),
      original_url: String(attachment?.original_url || attachment?.originalUrl || '').trim(),
      preview_url: String(attachment?.preview_url || attachment?.previewUrl || '').trim(),
      poster_url: String(attachment?.poster_url || attachment?.posterUrl || '').trim(),
    })),
  });
};

const areThreadMessagesEquivalent = (left, right) => (
  left === right
  || (
    normalizeThreadMessageId(left)
    && normalizeThreadMessageId(left) === normalizeThreadMessageId(right)
    && buildThreadMessageSignature(left) === buildThreadMessageSignature(right)
  )
);

const withPreservedThreadRenderKey = (message, existingMessage = null) => {
  if (!message?.id) return message;
  const nextRenderKey = String(
    existingMessage?.renderKey
    || existingMessage?.render_key
    || message?.renderKey
    || message?.render_key
    || message?.id
    || ''
  ).trim();
  if (!nextRenderKey || String(message?.renderKey || '').trim() === nextRenderKey) return message;
  return {
    ...message,
    renderKey: nextRenderKey,
  };
};

const isSendingOptimisticThreadMessage = (message, conversationId = '') => {
  const normalizedConversationId = String(conversationId || '').trim();
  if (!message?.isOptimistic) return false;
  if (String(message?.optimisticStatus || '').trim() !== 'sending') return false;
  if (!normalizedConversationId) return true;
  return String(message?.conversation_id || '').trim() === normalizedConversationId;
};

const sortThreadMessages = (messages) => (
  [...messages].sort((left, right) => {
    const createdDiff = String(left?.created_at || '').localeCompare(String(right?.created_at || ''));
    if (createdDiff !== 0) return createdDiff;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  })
);

const compareThreadMessagePosition = (left, right) => {
  const createdDiff = String(left?.created_at || '').localeCompare(String(right?.created_at || ''));
  if (createdDiff !== 0) return createdDiff;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
};

const shouldPreserveFreshLocalThreadMessage = ({
  message,
  conversationId = '',
  incomingIds,
  incomingLastMessage,
}) => {
  const normalizedMessageId = normalizeThreadMessageId(message);
  if (!normalizedMessageId || incomingIds.has(normalizedMessageId)) return false;
  if (message?.isOptimistic) return false;
  const normalizedConversationId = String(conversationId || '').trim();
  if (normalizedConversationId && String(message?.conversation_id || '').trim() !== normalizedConversationId) return false;
  if (!incomingLastMessage?.id) return false;
  return compareThreadMessagePosition(message, incomingLastMessage) > 0;
};

const shouldPreserveLoadedOlderThreadMessage = ({
  message,
  conversationId = '',
  incomingIds,
  incomingFirstMessage,
}) => {
  const normalizedMessageId = normalizeThreadMessageId(message);
  if (!normalizedMessageId || incomingIds.has(normalizedMessageId)) return false;
  if (message?.isOptimistic) return false;
  const normalizedConversationId = String(conversationId || '').trim();
  if (normalizedConversationId && String(message?.conversation_id || '').trim() !== normalizedConversationId) return false;
  if (!incomingFirstMessage?.id) return false;
  return compareThreadMessagePosition(message, incomingFirstMessage) < 0;
};

export const reconcileThreadMessages = (currentMessages, incomingMessages, {
  conversationId = '',
  preserveSendingOptimistic = false,
  mode = 'replace',
} = {}) => {
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const incoming = Array.isArray(incomingMessages) ? incomingMessages.filter((item) => item?.id) : [];
  const currentById = new Map(current.map((item) => [normalizeThreadMessageId(item), item]));
  const incomingIds = new Set(incoming.map((item) => normalizeThreadMessageId(item)).filter(Boolean));
  const currentOptimisticByClientId = new Map();
  current.forEach((item) => {
    const clientMessageId = normalizeThreadMessageClientId(item);
    if (clientMessageId && isSendingOptimisticThreadMessage(item, conversationId)) {
      currentOptimisticByClientId.set(clientMessageId, item);
    }
  });

  const serverClientIds = new Set();
  const next = incoming.map((message) => {
    const messageId = normalizeThreadMessageId(message);
    const clientMessageId = normalizeThreadMessageClientId(message);
    if (clientMessageId) serverClientIds.add(clientMessageId);
    const existing = currentById.get(messageId)
      || (clientMessageId ? currentOptimisticByClientId.get(clientMessageId) : null)
      || null;
    const nextMessage = withPreservedThreadRenderKey(message, existing);
    return areThreadMessagesEquivalent(existing, nextMessage) ? existing : nextMessage;
  });

  if (String(mode || '').trim() === 'replaceWindowButPreserveFreshLocal') {
    const sortedIncoming = sortThreadMessages(incoming);
    const incomingLastMessage = sortedIncoming.at(-1) || null;
    const incomingFirstMessage = sortedIncoming.at(0) || null;
    current.forEach((message) => {
      if (shouldPreserveFreshLocalThreadMessage({
        message,
        conversationId,
        incomingIds,
        incomingLastMessage,
      })) {
        next.push(message);
        return;
      }
      if (shouldPreserveLoadedOlderThreadMessage({
        message,
        conversationId,
        incomingIds,
        incomingFirstMessage,
      })) {
        next.push(message);
      }
    });
  }

  if (preserveSendingOptimistic) {
    current.forEach((message) => {
      const clientMessageId = normalizeThreadMessageClientId(message);
      if (!isSendingOptimisticThreadMessage(message, conversationId)) return;
      if (clientMessageId && serverClientIds.has(clientMessageId)) return;
      if (next.some((item) => normalizeThreadMessageId(item) === normalizeThreadMessageId(message))) return;
      next.push(message);
    });
  }

  const ordered = sortThreadMessages(next);
  if (ordered.length !== current.length) return ordered;
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index] !== current[index]) return ordered;
  }
  return current;
};

const hasPersistedThreadMessageEquivalent = (messages, message) => {
  const list = Array.isArray(messages) ? messages : [];
  const messageId = normalizeThreadMessageId(message);
  const clientMessageId = normalizeThreadMessageClientId(message);
  return list.some((item) => (
    !item?.isOptimistic
    && (
      (messageId && normalizeThreadMessageId(item) === messageId)
      || (clientMessageId && normalizeThreadMessageClientId(item) === clientMessageId)
    )
  ));
};

export const shouldSkipActiveThreadRevalidate = ({
  activeConversationId,
  conversationId,
  reason = '',
  messages = [],
  latestSocketMessage = null,
  now = Date.now(),
  dedupeMs = ACTIVE_THREAD_REVALIDATE_DEDUP_MS,
} = {}) => {
  const activeId = String(activeConversationId || '').trim();
  const targetId = String(conversationId || '').trim();
  if (!activeId || !targetId || activeId !== targetId) return false;

  const normalizedReason = String(reason || '').trim();
  const canDedupeReason = normalizedReason === 'message_created'
    || normalizedReason === 'created'
    || normalizedReason === 'updated'
    || normalizedReason === 'ai_run_completed'
    || normalizedReason === 'ai_run_failed';
  if (!canDedupeReason) return false;

  const socketConversationId = String(latestSocketMessage?.conversationId || '').trim();
  const socketMessageId = String(latestSocketMessage?.messageId || '').trim();
  const socketAt = Number(latestSocketMessage?.at || 0);
  if (!socketConversationId || socketConversationId !== targetId || !socketMessageId) return false;
  if (!Number.isFinite(socketAt) || socketAt <= 0) return false;
  if ((Number(now || Date.now()) - socketAt) > Number(dedupeMs || 0)) return false;

  return (Array.isArray(messages) ? messages : []).some((message) => (
    !message?.isOptimistic
    && String(message?.id || '').trim() === socketMessageId
  ));
};

export const getLatestPersistedThreadMessageId = (messages) => {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidateId = String(items[index]?.id || '').trim();
    if (candidateId && !isOptimisticThreadMessageId(candidateId)) {
      return candidateId;
    }
  }
  return '';
};

export const buildCursorInvalidThreadReloadOptions = (reason = 'thread') => ({
  silent: true,
  force: true,
  reason: `${String(reason || '').trim() || 'thread'}:cursor-invalid`,
});

export const buildActiveThreadPollLoadOptions = (messagesOrLastMessageId) => {
  const normalizedLastMessageId = Array.isArray(messagesOrLastMessageId)
    ? getLatestPersistedThreadMessageId(messagesOrLastMessageId)
    : String(messagesOrLastMessageId || '').trim();
  if (normalizedLastMessageId) {
    return {
      silent: true,
      afterMessageId: normalizedLastMessageId,
      reason: 'poll:active-thread:newer',
    };
  }
  return {
    silent: true,
    reason: 'poll:active-thread:bootstrap',
    force: true,
  };
};

export const isTransientLoadMessagesError = (error) => {
  const status = Number(error?.response?.status || 0);
  return status === 0 || status === 502 || status === 503 || status === 504;
};

export const isBackgroundLoadMessagesReason = (reason) => {
  const normalizedReason = String(reason || '').trim().toLowerCase();
  return normalizedReason.startsWith('poll:')
    || normalizedReason.includes(':revalidate')
    || normalizedReason.startsWith('window:')
    || normalizedReason.startsWith('socket:');
};

export const shouldNotifyLoadMessagesError = ({
  silent = false,
  reason = '',
  error = null,
  loadingOlderRequest = false,
  loadingNewerRequest = false,
} = {}) => {
  const code = String(error?.code || '');
  const name = String(error?.name || '');
  if (code === 'ERR_CANCELED' || name === 'CanceledError') return false;
  if (!silent) return true;
  if (isBackgroundLoadMessagesReason(reason)) return false;
  if (isTransientLoadMessagesError(error)) return false;
  return Boolean(loadingOlderRequest || loadingNewerRequest);
};
export const isRegularSidebarConversation = (item) => (
  Boolean(item) && String(item?.kind || '').trim() !== 'ai'
);

export const buildConversationFilterCounts = (conversations) => (
  buildFolderUnreadCounts(conversations, [], {})
);

export const filterSidebarConversations = (conversations, conversationFilter, conversationIdsByFolder = {}) => {
  const folderKey = conversationFilter === 'direct' ? 'personal' : String(conversationFilter || 'all');
  return filterSidebarConversationsByFolder(conversations, folderKey, conversationIdsByFolder);
};

export const buildThreadPrefetchQueue = (
  conversations,
  activeConversationId,
  {
    limit = 6,
  } = {},
) => {
  const items = Array.isArray(conversations) ? conversations : [];
  const normalizedActiveConversationId = String(activeConversationId || '').trim();
  const maxItems = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 0);
  if (maxItems <= 0) return [];

  const seen = new Set();
  const queue = [];
  const addConversation = (conversation) => {
    const conversationId = String(conversation?.id || '').trim();
    if (!conversationId || conversationId === normalizedActiveConversationId || seen.has(conversationId)) return;
    if (conversation?.is_archived) return;
    seen.add(conversationId);
    queue.push(conversationId);
  };

  const activeIndex = normalizedActiveConversationId
    ? items.findIndex((item) => String(item?.id || '').trim() === normalizedActiveConversationId)
    : -1;
  if (activeIndex >= 0) {
    addConversation(items[activeIndex + 1]);
    addConversation(items[activeIndex - 1]);
  }

  for (const item of items) {
    if (queue.length >= maxItems) break;
    addConversation(item);
  }

  return queue.slice(0, maxItems);
};

export const normalizeForwardMessageQueue = (messages) => {
  const source = Array.isArray(messages) ? messages : [messages];
  const seenIds = new Set();
  return source.filter((message) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId || seenIds.has(messageId)) return false;
    seenIds.add(messageId);
    return true;
  });
};

export const buildAiSidebarRows = ({
  aiBots,
  conversations,
  draftsByConversation,
  activeConversationId,
}) => {
  const aiConversationById = new Map(
    (Array.isArray(conversations) ? conversations : [])
      .filter((item) => String(item?.kind || '').trim() === 'ai' && String(item?.id || '').trim())
      .map((item) => [String(item.id).trim(), item]),
  );
  const normalizedActiveConversationId = String(activeConversationId || '').trim();
  const drafts = draftsByConversation && typeof draftsByConversation === 'object' ? draftsByConversation : {};
  return (Array.isArray(aiBots) ? aiBots : []).map((bot) => {
    const conversationId = String(bot?.conversation_id || '').trim();
    const conversation = conversationId ? aiConversationById.get(conversationId) : null;
    return {
      ...bot,
      conversation_id: conversationId || '',
      title: String(conversation?.title || bot?.title || 'AI').trim() || 'AI',
      last_message_preview: String(conversation?.last_message_preview || '').trim(),
      last_message_at: conversation?.last_message_at || '',
      updated_at: conversation?.updated_at || '',
      unread_count: Number(conversation?.unread_count || 0),
      is_pinned: Boolean(conversation?.is_pinned),
      is_muted: Boolean(conversation?.is_muted),
      is_archived: Boolean(conversation?.is_archived),
      draft_preview: conversationId ? String(drafts[conversationId] || '').trim() : '',
      is_active: Boolean(conversationId && conversationId === normalizedActiveConversationId),
    };
  });
};
const CHAT_ARCHIVE_UPLOAD_WARNING = 'Архивы (.zip, .rar, .7z, .tar, .gz) нельзя отправлять в чат.';

const TELEGRAM_LIGHT_THREAD_PATTERN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160' fill='none' stroke='%2389a36a' stroke-opacity='0.22' stroke-width='1.35' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 29c7-7 16-7 23 0 7 7 16 7 23 0'/%3E%3Cpath d='M111 20c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z'/%3E%3Cpath d='M118 70c10-8 20-8 30 0'/%3E%3Cpath d='M19 95h18l7 12 8-24 8 17h18'/%3E%3Cpath d='M103 111c4-8 12-13 21-13 5 0 10 2 14 5-4 8-12 13-21 13-5 0-10-2-14-5Z'/%3E%3Cpath d='M53 133c0-6 5-11 11-11s11 5 11 11-5 11-11 11-11-5-11-11Z'/%3E%3Cpath d='M128 134l8-8m0 8-8-8'/%3E%3Cpath d='M76 42l5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2 5-10Z'/%3E%3C/svg%3E\")";
const TELEGRAM_DARK_THREAD_PATTERN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160' fill='none' stroke='%23788fa3' stroke-opacity='0.18' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 29c7-7 16-7 23 0 7 7 16 7 23 0'/%3E%3Cpath d='M111 20c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z'/%3E%3Cpath d='M118 70c10-8 20-8 30 0'/%3E%3Cpath d='M19 95h18l7 12 8-24 8 17h18'/%3E%3Cpath d='M103 111c4-8 12-13 21-13 5 0 10 2 14 5-4 8-12 13-21 13-5 0-10-2-14-5Z'/%3E%3Cpath d='M53 133c0-6 5-11 11-11s11 5 11 11-5 11-11 11-11-5-11-11Z'/%3E%3Cpath d='M128 134l8-8m0 8-8-8'/%3E%3Cpath d='M76 42l5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2 5-10Z'/%3E%3C/svg%3E\")";

const readSessionStorageValue = (storageKey) => {
  const normalizedStorageKey = String(storageKey || '').trim();
  if (!normalizedStorageKey) return '';
  try {
    return String(window.sessionStorage.getItem(normalizedStorageKey) || '').trim();
  } catch {
    return '';
  }
};

const readLocalStorageJsonObject = (storageKey) => {
  const normalizedStorageKey = String(storageKey || '').trim();
  if (!normalizedStorageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(normalizedStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeLocalStorageJsonObject = (storageKey, value) => {
  const normalizedStorageKey = String(storageKey || '').trim();
  if (!normalizedStorageKey || typeof window === 'undefined') return;
  try {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      window.localStorage.setItem(normalizedStorageKey, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(normalizedStorageKey);
    }
  } catch {
    // Ignore browser storage failures for lightweight chat UI state.
  }
};

const readSelectedDatabaseId = () => {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem('selected_database') || '').trim();
  } catch {
    return '';
  }
};

export default function Chat() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
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
  const restoredMobileView = readSessionStorageValue(lastMobileViewSessionKey) === 'thread' ? 'thread' : 'inbox';
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

  const composerRef = useRef(null);
  const bottomRef = useRef(null);
  const sidebarScrollRef = useRef(null);
  const threadScrollRef = useRef(null);
  const pinnedScrollRef = useRef(null);
  const threadContentRef = useRef(null);
  const autoScrollRef = useRef(false);
  const autoScrollMetaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const composerSelectionRef = useRef({ start: null, end: null });
  const invalidConversationRef = useRef('');
  const activeConversationIdRef = useRef('');
  const conversationsRef = useRef([]);
  const messagesRef = useRef([]);
  const requestedConversationHandledRef = useRef('');
  const requestedConversationRetryRef = useRef('');
  const applyingRequestedConversationRef = useRef('');
  const requestedMessageRevealKeyRef = useRef('');
  const conversationsRequestSeqRef = useRef(0);
  const conversationsLoadingRequestSeqRef = useRef(0);
  const conversationsLoadingRef = useRef(true);
  const messagesRequestSeqRef = useRef(0);
  const messagesLoadingRequestSeqRef = useRef(0);
  const messagesLoadingRef = useRef(false);
  const threadNearBottomRef = useRef(true);
  const threadViewportSyncFrameRef = useRef(null);
  const bottomInstantSettleFrameRef = useRef(null);
  const mobileKeyboardSettleTimeoutsRef = useRef([]);
  const prependScrollRestoreRef = useRef(null);
  const loadOlderInFlightCursorRef = useRef('');
  const messagesHasMoreRef = useRef(false);
  const messagesHasNewerRef = useRef(false);
  const highlightResetTimeoutRef = useRef(null);
  const suppressDraftSyncRef = useRef(false);
  const revealMessageRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const typingParticipantsTimeoutsRef = useRef(new Map());
  const typingStartedRef = useRef(false);
  const loadMessagesRef = useRef(null);
  const markConversationReadLiveRef = useRef(null);
  const focusComposerRef = useRef(null);
  const shareComposePrefillHandledRef = useRef(false);
  const shareComposeDraftRef = useRef(null);
  const queueInitialThreadPositionRef = useRef(null);
  const cancelPendingInitialAnchorRef = useRef(null);
  const lastForegroundRefreshAtRef = useRef(0);
  const logChatDebugRef = useRef(null);
  const socketStatusRef = useRef(CHAT_WS_ENABLED ? 'connecting' : 'disabled');
  const lastSocketActivityAtRef = useRef(0);
  const latestActiveThreadSocketMessageRef = useRef(null);
  const degradedThreadRevalidateCountRef = useRef(0);
  const showJumpToLatestRef = useRef(false);
  const loadConversationsRef = useRef(null);
  const openMobileThreadViewRef = useRef(null);
  const aiRunStartedAtByConversationRef = useRef({});
  const pendingInitialAnchorRef = useRef(null);
  const pendingInitialAnchorSettleTimeoutRef = useRef(null);
  const pendingInitialAnchorRetryTimeoutRef = useRef(null);
  const pendingInitialAnchorResizeFrameRef = useRef(null);
  const suppressThreadScrollCancelRef = useRef(false);
  const chatDebugSeqRef = useRef(0);
  const optimisticMessageSeqRef = useRef(0);
  const draftWriteTimeoutRef = useRef(null);
  const latestDraftStorageKeyRef = useRef('');
  const latestMessageTextRef = useRef('');
  const fileUploadAbortRef = useRef(null);
  const threadLoadAbortRef = useRef(null);
  const threadPrefetchAbortControllersRef = useRef(new Map());
  const skippedInitialSocketRefreshRef = useRef(false);
  const skippedInitialSnapshotRefreshRef = useRef(false);
  const lastConversationsLoadAtRef = useRef(0);
  const conversationsCacheHydratedRef = useRef(Boolean(initialConversationsCache?.data));
  const aiBotsCacheHydratedRef = useRef(Boolean(initialAiBotsCache?.data));
  const aiBotsRequestSeqRef = useRef(0);
  const aiBotsLoadingRequestSeqRef = useRef(0);
  const aiBotsLoadingRef = useRef(canUseAiChat ? !initialAiBotsCache?.data : false);
  const hydratedThreadConversationIdRef = useRef(initialThreadCache?.data ? initialConversationId : '');
  const mobileHistoryReadyRef = useRef(false);
  const notesEnsuredRef = useRef(false);
  const mobileHistoryModeRef = useRef('inbox');
  const lastHandledThreadLayoutKeyRef = useRef('');
  const initialViewportGuardRef = useRef(null);
  const initialViewportGuardTimeoutRef = useRef(null);
  const programmaticScrollHistoryRef = useRef([]);

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
  const {
    patchSearchConversations,
    patchSearchPersonPresence,
    resetSidebarSearch,
    searchChats,
    searchPeople,
    searchResultEmpty,
    searchingSidebar,
    setSidebarQuery,
    sidebarQuery,
    sidebarSearchActive,
    upsertSearchConversation,
  } = useChatSidebarSearch({
    notifyApiError,
    searchDebounceMs: SEARCH_MS,
  });
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
  const [messages, setMessages] = useState(() => (
    Array.isArray(initialThreadCache?.data?.items) ? initialThreadCache.data.items : []
  ));
  const [messagesLoading, setMessagesLoading] = useState(() => Boolean(initialConversationId && !initialThreadCache?.data));
  const [messagesHasMore, setMessagesHasMore] = useState(() => Boolean(initialThreadCache?.data?.has_more));
  const [messagesHasNewer, setMessagesHasNewer] = useState(() => Boolean(initialThreadCache?.data?.has_newer));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewerLastReadMessageId, setViewerLastReadMessageId] = useState(() => String(initialThreadCache?.data?.viewer_last_read_message_id || '').trim());
  const [viewerLastReadAt, setViewerLastReadAt] = useState(() => String(initialThreadCache?.data?.viewer_last_read_at || '').trim());
  const [messageText, setMessageText] = useState('');
  const [replyMessage, setReplyMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const {
    addGroupMember,
    closeGroupDialog,
    createGroup,
    creatingConversation,
    groupCreateDisabled,
    groupMemberIds,
    groupOpen,
    groupSearch,
    groupSelectedUsers,
    groupTitle,
    groupUsers,
    groupUsersLoading,
    openGroupDialog,
    patchGroupPresence,
    removeGroupMember,
    setGroupSearch,
    setGroupTitle,
  } = useChatGroupDialog({
    isMobile,
    loadChatDialogsModule,
    loadConversationsRef,
    notifyApiError,
    openMobileThreadViewRef,
    searchDebounceMs: SEARCH_MS,
    setActiveConversationId,
  });
  const [openingPeerId, setOpeningPeerId] = useState('');
  const [threadMenuAnchor, setThreadMenuAnchor] = useState(null);
  const [messageMenuAnchor, setMessageMenuAnchor] = useState(null);
  const [messageMenuMessage, setMessageMenuMessage] = useState(null);
  const [composerMenuAnchor, setComposerMenuAnchor] = useState(null);
  const {
    openShareDialog,
    resetShareDialog,
    setSharingTaskId,
    setTaskSearch,
    shareOpen,
    shareableLoading,
    shareableTasks,
    sharingTaskId,
    taskSearch,
  } = useChatTaskShareDialog({
    activeConversationId,
    loadChatDialogsModule,
    notifyApiError,
    searchDebounceMs: SEARCH_MS,
    setComposerMenuAnchor,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  });
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardConversationQuery, setForwardConversationQuery] = useState('');
  const [forwardingConversationId, setForwardingConversationId] = useState('');
  const [forwardMessages, setForwardMessages] = useState([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [selectedUploadItems, setSelectedUploadItems] = useState([]);
  const [fileCaption, setFileCaption] = useState('');
  const [preparingFiles, setPreparingFiles] = useState(false);
  const [sendingFiles, setSendingFiles] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(0);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  showJumpToLatestRef.current = showJumpToLatest;
  const [infoOpen, setInfoOpen] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [emojiAnchorEl, setEmojiAnchorEl] = useState(null);
  const [messageReadsOpen, setMessageReadsOpen] = useState(false);
  const [messageReadsLoading, setMessageReadsLoading] = useState(false);
  const [messageReadsItems, setMessageReadsItems] = useState([]);
  const [messageReadsMessage, setMessageReadsMessage] = useState(null);
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const {
    closeSearchDialog,
    loadMoreSearchResults,
    messageSearch,
    messageSearchHasMore,
    messageSearchLoading,
    messageSearchResults,
    openSearchDialog,
    openSearchResult,
    resetMessageSearch,
    searchOpen,
    setMessageSearch,
  } = useChatMessageSearch({
    activeConversationId,
    activeConversationIdRef,
    loadChatDialogsModule,
    notifyApiError,
    notifyInfo,
    revealMessageRef,
    searchDebounceMs: SEARCH_MS,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  });
  const selectedFiles = useMemo(
    () => selectedUploadItems.map((item) => item?.file).filter(Boolean),
    [selectedUploadItems],
  );
  const selectedFilesSummary = useMemo(
    () => summarizePreparedChatUploadItems(selectedUploadItems),
    [selectedUploadItems],
  );
  const selectedMessageIdSet = useMemo(
    () => new Set((Array.isArray(selectedMessageIds) ? selectedMessageIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
    [selectedMessageIds],
  );
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIdSet.has(String(message?.id || '').trim())),
    [messages, selectedMessageIdSet],
  );
  const selectedVisibleMessageIds = useMemo(
    () => selectedMessages.map((message) => String(message?.id || '').trim()).filter(Boolean),
    [selectedMessages],
  );
  const selectedMessageCount = selectedMessages.length;
  const canCopySelectedMessages = selectedMessages.some((message) => String(getMessagePreview(message) || '').trim());
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const [socketStatus, setSocketStatus] = useState(CHAT_WS_ENABLED ? 'connecting' : 'disabled');
  const [lastSocketActivityAt, setLastSocketActivityAt] = useState(0);
  const [typingUsers, setTypingUsers] = useState([]);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const deferredMessageText = useDeferredValue(messageText);

  useEffect(() => () => {
    try {
      fileUploadAbortRef.current?.abort?.();
    } catch {
      // Ignore abort cleanup failures on unmount.
    }
    if (bottomInstantSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomInstantSettleFrameRef.current);
      bottomInstantSettleFrameRef.current = null;
    }
  }, []);

  const activeConversationSummary = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || searchChats.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations, searchChats],
  );

  const activeConversation = useMemo(() => {
    const normalizedConversationId = String(activeConversationSummary?.id || activeConversationId || '').trim();
    const detail = normalizedConversationId ? conversationDetailsById[normalizedConversationId] : null;
    if (!activeConversationSummary) {
      return detail || null;
    }
    if (!detail) {
      return activeConversationSummary;
    }
    return {
      ...activeConversationSummary,
      ...detail,
      direct_peer: detail?.direct_peer || activeConversationSummary?.direct_peer || null,
      member_preview: Array.isArray(detail?.member_preview) && detail.member_preview.length > 0
        ? detail.member_preview
        : (Array.isArray(activeConversationSummary?.member_preview) ? activeConversationSummary.member_preview : []),
      members: Array.isArray(detail?.members) ? detail.members : undefined,
    };
  }, [activeConversationId, activeConversationSummary, conversationDetailsById]);
  const mentionCandidates = useMemo(() => {
    const currentUserId = Number(user?.id || 0);
    const byKey = new Map();
    const addPerson = (value) => {
      const person = value?.user || value;
      if (!person || typeof person !== 'object') return;
      const personId = Number(person?.id || 0);
      if (Number.isFinite(personId) && personId > 0 && personId === currentUserId) return;
      const username = String(person?.username || '').trim();
      const fullName = String(person?.full_name || person?.name || '').trim();
      if (!username && !fullName) return;
      const key = personId > 0 ? `id:${personId}` : `username:${username.toLowerCase()}`;
      if (!key || byKey.has(key)) return;
      byKey.set(key, person);
    };
    addPerson(activeConversation?.direct_peer);
    (Array.isArray(activeConversation?.members) ? activeConversation.members : []).forEach(addPerson);
    (Array.isArray(activeConversation?.member_preview) ? activeConversation.member_preview : []).forEach(addPerson);
    searchPeople.slice(0, 12).forEach(addPerson);
    return Array.from(byKey.values()).slice(0, 32);
  }, [activeConversation, searchPeople, user?.id]);
  const searchMentionPeople = useCallback(async (query) => {
    const normalizedQuery = String(query || '').trim().replace(/^@+/, '');
    if (!normalizedQuery) return [];
    const response = await chatAPI.getUsers({ q: normalizedQuery, limit: 8 });
    return Array.isArray(response?.items) ? response.items : [];
  }, []);
  const activeAiStatus = useMemo(
    () => aiStatusByConversation[String(activeConversationId || '').trim()] || null,
    [activeConversationId, aiStatusByConversation],
  );
  const activeAiStatusDisplay = useMemo(
    () => buildAiStatusDisplayModel(activeAiStatus),
    [activeAiStatus],
  );
  const aiTypingStatus = useMemo(() => {
    if (String(activeConversation?.kind || '').trim() !== 'ai') return null;
    if (activeAiStatusDisplay.visible) return null;
    const status = String(activeAiStatus?.status || '').trim();
    const visible = status === 'queued' || status === 'running';
    if (!visible) return null;
    return {
      visible: true,
      botName: String(activeAiStatus?.bot_title || activeAiStatusDisplay?.primaryText || 'AI Ассистент').trim() || 'AI Ассистент',
    };
  }, [activeAiStatus, activeAiStatusDisplay, activeConversation?.kind]);
  const activeAiLiveDataNotice = useMemo(
    () => buildAiLiveDataNotice({
      activeConversationKind: activeConversation?.kind,
      activeConversationId,
      aiStatus: activeAiStatus,
      aiBots,
    }),
    [activeAiStatus, activeConversation?.kind, activeConversationId, aiBots],
  );
  const setOptimisticAiQueuedStatus = useCallback((conversationId, botTitle = '') => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    setAiStatusByConversation((current) => ({
      ...(current && typeof current === 'object' ? current : {}),
      [normalizedConversationId]: {
        conversation_id: normalizedConversationId,
        bot_title: String(botTitle || '').trim() || null,
        status: 'queued',
        stage: 'queued',
        status_text: AI_STATUS_FALLBACK_TEXTS.queued,
        error_text: null,
        updated_at: new Date().toISOString(),
      },
    }));
  }, []);
  const clearStoredConversationState = useCallback(({ conversationId = '', invalidateThread = false } = {}) => {
    try {
      window.sessionStorage.removeItem(lastConversationSessionKey);
      window.sessionStorage.removeItem(lastMobileViewSessionKey);
    } catch {
      // Ignore browser storage failures for chat session restore.
    }
    if (invalidateThread) {
      const normalizedConversationId = String(conversationId || '').trim();
      if (normalizedConversationId) {
        invalidateSWRCacheByPrefix('chat', 'thread', userCacheId, normalizedConversationId);
      }
    }
  }, [lastConversationSessionKey, lastMobileViewSessionKey, userCacheId]);

  const applyConversationsPayload = useCallback((payload, { preserveSidebarScrollTop = null } = {}) => {
    const items = sortSidebarConversations(Array.isArray(payload?.items) ? payload.items : []);
    lastConversationsLoadAtRef.current = Date.now();
    conversationsCacheHydratedRef.current = true;
    setConversations(items);
    if (preserveSidebarScrollTop !== null) {
      window.requestAnimationFrame(() => {
        if (sidebarScrollRef.current) {
          sidebarScrollRef.current.scrollTop = preserveSidebarScrollTop;
        }
      });
    }
    return items;
  }, []);

  const upsertConversationDetail = useCallback((conversation) => {
    const normalizedConversationId = String(conversation?.id || '').trim();
    if (!normalizedConversationId) return;
    setConversationDetailsById((current) => ({
      ...current,
      [normalizedConversationId]: {
        ...(current[normalizedConversationId] || {}),
        ...conversation,
        member_preview: Array.isArray(conversation?.member_preview)
          ? conversation.member_preview
          : (current[normalizedConversationId]?.member_preview || []),
        members: Array.isArray(conversation?.members)
          ? conversation.members
          : current[normalizedConversationId]?.members,
      },
    }));
  }, []);

  const applyLatestThreadPayload = useCallback((conversationId, payload, { hydrateLatestCache = true } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return [];
    const items = Array.isArray(payload?.items) ? payload.items : [];
    hydratedThreadConversationIdRef.current = hydrateLatestCache ? normalizedConversationId : '';
    setViewerLastReadMessageId(String(payload?.viewer_last_read_message_id || '').trim());
    setViewerLastReadAt(String(payload?.viewer_last_read_at || '').trim());
    setMessages((current) => {
      const next = reconcileThreadMessages(current, items, {
        conversationId: normalizedConversationId,
        preserveSendingOptimistic: true,
        mode: 'replaceWindowButPreserveFreshLocal',
      });
      const sortedIncoming = sortThreadMessages(items);
      const incomingFirstMessage = sortedIncoming.at(0) || null;
      const preservedOlderCount = next.filter((message) => (
        !items.some((item) => normalizeThreadMessageId(item) === normalizeThreadMessageId(message))
        && compareThreadMessagePosition(message, incomingFirstMessage) < 0
      )).length;
      const payloadHasOlder = Boolean(payload?.has_older ?? payload?.has_more);
      const extendedHistory = next.length > items.length;
      setMessagesHasMore(extendedHistory ? (payloadHasOlder || messagesHasMoreRef.current) : payloadHasOlder);
      // #region agent log
      if (preservedOlderCount > 0) {
        emitAgentDebugLog({
          location: 'Chat.jsx:applyLatestThreadPayload',
          message: 'preserved loaded older messages during thread revalidate',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: normalizedConversationId,
            incomingCount: items.length,
            currentCount: current.length,
            nextCount: next.length,
            preservedOlderCount,
          },
        });
      } else if (next.length < current.length) {
        emitAgentDebugLog({
          location: 'Chat.jsx:applyLatestThreadPayload',
          message: 'thread message count decreased during revalidate',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: normalizedConversationId,
            incomingCount: items.length,
            currentCount: current.length,
            nextCount: next.length,
          },
        });
      }
      // #endregion
      return next;
    });
    setMessagesHasNewer(Boolean(payload?.has_newer));
    return items;
  }, []);

  const loadConversationDetail = useCallback(async (conversationId, { force = false, signal } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return null;
    if (typeof chatAPI.getConversation !== 'function') return null;
    const existingDetail = conversationDetailsById[normalizedConversationId];
    if (!force && Array.isArray(existingDetail?.members) && existingDetail.members.length > 0) {
      return existingDetail;
    }
    const detail = await chatAPI.getConversation(normalizedConversationId, { signal });
    if (detail?.id) {
      upsertConversationDetail(detail);
    }
    return detail;
  }, [conversationDetailsById, upsertConversationDetail]);

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, item) => sum + Number(item?.unread_count || 0), 0),
    [conversations],
  );

  const conversationFilterCounts = useMemo(
    () => buildFolderUnreadCounts(conversations, customFolders, conversationIdsByFolder),
    [conversationIdsByFolder, conversations, customFolders],
  );

  const filteredConversations = useMemo(
    () => filterSidebarConversationsByFolder(conversations, conversationFilter, conversationIdsByFolder),
    [conversationFilter, conversationIdsByFolder, conversations],
  );

  const watchedPresenceUserIds = useMemo(() => {
    const result = new Set();
    const addPerson = (person) => {
      const personId = Number(person?.id || person?.user?.id || 0);
      if (Number.isFinite(personId) && personId > 0) {
        result.add(personId);
      }
    };
    const addConversationPeople = (conversation) => {
      if (!conversation || typeof conversation !== 'object') return;
      addPerson(conversation?.direct_peer);
      (Array.isArray(conversation?.member_preview) ? conversation.member_preview : []).forEach((member) => addPerson(member?.user || member));
      (Array.isArray(conversation?.members) ? conversation.members : []).forEach((member) => addPerson(member?.user || member));
    };

    conversations.slice(0, 20).forEach(addConversationPeople);
    searchChats.slice(0, 10).forEach(addConversationPeople);
    addConversationPeople(activeConversation);
    searchPeople.slice(0, 10).forEach(addPerson);
    groupUsers.slice(0, 10).forEach(addPerson);
    groupSelectedUsers.slice(0, 10).forEach(addPerson);
    messageReadsItems.slice(0, 10).forEach((item) => addPerson(item?.user));

    return Array.from(result).slice(0, 50);
  }, [activeConversation, conversations, groupSelectedUsers, groupUsers, messageReadsItems, searchChats, searchPeople]);

  const watchedPresenceUserIdsKey = useMemo(
    () => [...watchedPresenceUserIds].sort((left, right) => left - right).join(','),
    [watchedPresenceUserIds],
  );

  const forwardTargets = useMemo(() => {
    const normalizedQuery = String(forwardConversationQuery || '').trim().toLowerCase();
    return conversations.filter((item) => {
      if (!item || item?.is_archived) return false;
      if (String(item?.id || '').trim() === String(activeConversationId || '').trim()) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        item?.title,
        item?.direct_peer?.full_name,
        item?.direct_peer?.username,
        item?.last_message_preview,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [activeConversationId, conversations, forwardConversationQuery]);

  useEffect(() => {
    setSelectedMessageIds([]);
    setForwardMessages([]);
  }, [activeConversationId]);

  const flushDraftToStorage = useCallback((storageKey, value) => {
    const normalizedStorageKey = String(storageKey || '').trim();
    if (!normalizedStorageKey) return;
    try {
      if (String(value || '').trim()) {
        window.localStorage.setItem(normalizedStorageKey, String(value || ''));
      } else {
        window.localStorage.removeItem(normalizedStorageKey);
      }
    } catch {
      // Ignore browser storage failures for drafts.
    }
  }, []);

  const draftsByConversation = useMemo(() => {
    const drafts = {};
    const conversationItems = Array.isArray(conversations) ? conversations : [];
    conversationItems.forEach((item) => {
      const conversationId = String(item?.id || '').trim();
      if (!conversationId) return;
      const storageKey = buildChatDraftKey(user?.id, conversationId);
      let value = '';
      if (conversationId === activeConversationId) {
        value = String(deferredMessageText || '').trim();
      } else if (storageKey) {
        try {
          value = String(window.localStorage.getItem(storageKey) || '').trim();
        } catch {
          value = '';
        }
      }
      if (value) drafts[conversationId] = value;
    });
    return drafts;
  }, [activeConversationId, conversations, deferredMessageText, user?.id]);

  const aiSidebarRows = useMemo(
    () => buildAiSidebarRows({
      aiBots,
      conversations,
      draftsByConversation,
      activeConversationId,
    }),
    [activeConversationId, aiBots, conversations, draftsByConversation],
  );

  const showContextPanel = !isMobile && contextPanelOpen;
  const renderDesktopContextPanel = !isMobile && Boolean(activeConversation) && showContextPanel;
  const emojiPickerOpen = Boolean(emojiAnchorEl);
  const shouldRenderChatDialogs = Boolean(
    threadMenuAnchor
    || messageMenuAnchor
    || composerMenuAnchor
    || emojiAnchorEl
    || groupOpen
    || shareOpen
    || forwardOpen
    || fileDialogOpen
    || attachmentPreview
    || documentPreview
    || messageReadsOpen
    || searchOpen
    || (isMobile && infoOpen),
  );
  const contextPanelEnterDuration = prefersReducedMotion ? 1 : CONTEXT_PANEL_ENTER_MS;
  const contextPanelExitDuration = prefersReducedMotion ? 1 : CONTEXT_PANEL_EXIT_MS;
  const mobileScreenTransition = mobileMotionDisabled
    ? { duration: 0.01 }
    : {
      type: 'tween',
      duration: CHAT_MOBILE_SCREEN_TRANSITION_MS / 1000,
      ease: CHAT_MOBILE_SCREEN_TRANSITION_EASE,
    };
  const resolvedMobileView = isMobile
    && mobileView === 'thread'
    && !String(activeConversationId || '').trim()
      ? 'inbox'
      : (
        isMobile
        && mobileView === 'thread'
        && conversationBootstrapComplete
        && !activeConversation
        && !messagesLoading
        && !requestedConversationId
          ? 'inbox'
          : mobileView
      );

  useEffect(() => {
    if (!isMobile) {
      setMobileBottomNavHidden(false);
      return undefined;
    }
    if (resolvedMobileView !== 'thread') {
      setMobileBottomNavHidden(false);
      return undefined;
    }
    if (mobileMotionDisabled) {
      setMobileBottomNavHidden(true);
    }
    return undefined;
  }, [isMobile, mobileMotionDisabled, resolvedMobileView]);

  const handleMobileThreadScreenAnimationComplete = useCallback((definition) => {
    if (definition !== 'center') return;
    if (!isMobile || mobileMotionDisabled) return;
    if (resolvedMobileView !== 'thread') return;
    setMobileBottomNavHidden(true);
  }, [isMobile, mobileMotionDisabled, resolvedMobileView]);

  const threadWallpaperSx = useMemo(
    () => (
      theme.palette.mode === 'dark'
        ? {
          backgroundColor: ui.threadBg,
          backgroundImage: `
            radial-gradient(circle at 0% 0%, ${alpha(theme.palette.primary.main, 0.1)} 0%, transparent 34%),
            radial-gradient(circle at 100% 100%, ${alpha('#78a7c6', 0.08)} 0%, transparent 32%),
            linear-gradient(180deg, ${alpha('#17212b', 0.64)} 0%, ${alpha(ui.threadBg, 0.96)} 100%),
            ${TELEGRAM_DARK_THREAD_PATTERN}
          `,
          backgroundSize: 'auto, auto, auto, 160px 160px',
          backgroundPosition: '0 0, 100% 100%, 0 0, 0 0',
        }
        : {
          backgroundColor: ui.threadBg,
          backgroundImage: `
            radial-gradient(circle at 0% 0%, rgba(246, 234, 161, 0.82) 0%, rgba(246, 234, 161, 0) 33%),
            radial-gradient(circle at 100% 100%, rgba(243, 233, 171, 0.62) 0%, rgba(243, 233, 171, 0) 32%),
            linear-gradient(135deg, rgba(229, 239, 181, 0.82) 0%, rgba(191, 219, 151, 0.9) 44%, rgba(168, 208, 151, 0.94) 100%),
            ${TELEGRAM_LIGHT_THREAD_PATTERN}
          `,
          backgroundSize: 'auto, auto, auto, 160px 160px',
          backgroundPosition: '0 0, 100% 100%, 0 0, 0 0',
        }
    ),
    [theme, ui.threadBg],
  );

  const conversationHeaderSubtitle = useMemo(
    () => (
      typingUsers.length > 0
        ? `${typingUsers.join(', ')} печатает...`
        : getConversationHeaderSubtitle(activeConversation)
    ),
    [activeConversation, typingUsers],
  );

  const conversationMetaSubtitle = useMemo(
    () => getConversationHeaderSubtitle(activeConversation),
    [activeConversation],
  );
  socketStatusRef.current = socketStatus;

  const markSocketActivity = useCallback((source = 'socket:event') => {
    const nextTimestamp = Date.now();
    lastSocketActivityAtRef.current = nextTimestamp;
    setLastSocketActivityAt((current) => {
      const previous = Number(current || 0);
      if (previous > 0 && (nextTimestamp - previous) < SOCKET_ACTIVITY_COALESCE_MS) {
        return current;
      }
      return nextTimestamp;
    });
    logChatDebugRef.current?.('socket:activity', {
      source: String(source || '').trim() || 'socket:event',
      lastSocketActivityAt: nextTimestamp,
    });
  }, []);

  const activeThreadTransportState = useMemo(
    () => resolveActiveThreadTransportState({
      activeConversationId,
      socketStatus,
      lastSocketActivityAt,
    }),
    [activeConversationId, lastSocketActivityAt, socketStatus],
  );

  const getCurrentBrowserConversationId = useCallback(() => {
    if (typeof window === 'undefined') return '';
    return String(new URLSearchParams(window.location.search).get('conversation') || '').trim();
  }, []);

  const buildMobileHistoryUrl = useCallback((nextState, conversationId = activeConversationIdRef.current) => {
    const currentPathname = typeof window !== 'undefined' ? window.location.pathname : location.pathname;
    const currentSearch = typeof window !== 'undefined' ? window.location.search : location.search;
    const currentHash = typeof window !== 'undefined' ? window.location.hash : location.hash;
    const params = new URLSearchParams(currentSearch);
    const normalizedConversationId = String(conversationId || '').trim();
    const nextView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    if (nextView === 'thread' && normalizedConversationId) {
      params.set('conversation', normalizedConversationId);
    } else {
      params.delete('conversation');
    }
    const shouldPreserveFocusedMessage = (
      nextView === 'thread'
      && normalizedConversationId
      && normalizedConversationId === requestedConversationId
      && Boolean(requestedMessageId)
    );
    if (!shouldPreserveFocusedMessage) {
      params.delete('message');
    }
    const nextSearch = params.toString();
    return `${currentPathname}${nextSearch ? `?${nextSearch}` : ''}${currentHash || ''}`;
  }, [location.hash, location.pathname, location.search, requestedConversationId, requestedMessageId]);

  const getMobileHistoryKey = useCallback((nextState, conversationId = activeConversationIdRef.current) => {
    const nextView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    const drawerKey = 'closed';
    const infoKey = nextView === 'thread' && Boolean(nextState?.infoOpen) ? 'info' : 'main';
    const normalizedConversationId = nextView === 'thread'
      ? (String(conversationId || '').trim() || 'none')
      : 'none';
    return `${nextView}:${drawerKey}:${infoKey}:${normalizedConversationId}`;
  }, []);

  const readMobileHistoryState = useCallback((state = window.history.state) => (
    readChatMobileHistoryState(state)
  ), []);

  const writeMobileHistoryState = useCallback((nextState, strategy = 'push', conversationId = activeConversationIdRef.current) => {
    if (!isMobile || typeof window === 'undefined') return;
    const normalizedView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    const normalizedDrawerOpen = false;
    const normalizedInfoOpen = normalizedView === 'thread' && Boolean(nextState?.infoOpen);
    const currentState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {};
    const nextHistoryState = {
      ...currentState,
      [CHAT_MOBILE_HISTORY_FLAG]: true,
      [CHAT_MOBILE_HISTORY_VIEW_KEY]: normalizedView,
      [CHAT_MOBILE_HISTORY_DRAWER_KEY]: normalizedDrawerOpen,
      [CHAT_MOBILE_HISTORY_INFO_KEY]: normalizedInfoOpen,
    };
    const nextUrl = buildMobileHistoryUrl({ view: normalizedView, drawerOpen: normalizedDrawerOpen }, conversationId);
    if (strategy === 'replace') {
      window.history.replaceState(nextHistoryState, '', nextUrl);
    } else {
      window.history.pushState(nextHistoryState, '', nextUrl);
    }
    mobileHistoryModeRef.current = getMobileHistoryKey(
      { view: normalizedView, drawerOpen: normalizedDrawerOpen, infoOpen: normalizedInfoOpen },
      conversationId,
    );
  }, [buildMobileHistoryUrl, getMobileHistoryKey, isMobile]);

  const openMobileThreadView = useCallback((conversationId = activeConversationIdRef.current) => {
    if (!isMobile) return;
    const normalizedConversationId = String(conversationId || activeConversationIdRef.current).trim();
    closeDrawer?.();
    setInfoOpen(false);
    setMobileTransitionDirection(1);
    setMobileView('thread');
    if (!mobileHistoryReadyRef.current || typeof window === 'undefined' || !normalizedConversationId) return;
    const nextState = { view: 'thread', drawerOpen: false, infoOpen: false };
    const currentState = readMobileHistoryState();
    const currentConversationId = currentState?.view === 'thread' ? getCurrentBrowserConversationId() : '';
    const currentHistoryKey = currentState ? getMobileHistoryKey(currentState, currentConversationId) : '';
    const nextHistoryKey = getMobileHistoryKey(nextState, normalizedConversationId);
    if (currentHistoryKey === nextHistoryKey) return;
    writeMobileHistoryState(nextState, 'push', normalizedConversationId);
  }, [closeDrawer, getCurrentBrowserConversationId, getMobileHistoryKey, isMobile, readMobileHistoryState, writeMobileHistoryState]);
  openMobileThreadViewRef.current = openMobileThreadView;

  const openMobileInboxView = useCallback(() => {
    if (!isMobile) return;
    setMobileBottomNavHidden(false);
    const currentMobileHistoryState = typeof window !== 'undefined' && mobileHistoryReadyRef.current
      ? readMobileHistoryState()
      : null;
    if (currentMobileHistoryState?.view === 'thread' && currentMobileHistoryState?.infoOpen) {
      setInfoOpen(false);
      window.history.back();
      return;
    }
    if (currentMobileHistoryState?.view === 'thread' && !currentMobileHistoryState?.drawerOpen) {
      closeDrawer?.();
      setInfoOpen(false);
      setMobileTransitionDirection(-1);
      setMobileView('inbox');
      window.history.back();
      return;
    }
    closeDrawer?.();
    setInfoOpen(false);
    setMobileTransitionDirection(-1);
    setMobileView('inbox');
  }, [closeDrawer, isMobile, readMobileHistoryState]);

  const typingLine = useMemo(
    () => (typingUsers.length > 0 ? `${typingUsers.join(', ')} печатает...` : ''),
    [typingUsers],
  );

  const aiAwareTypingLine = useMemo(() => {
    if (String(activeConversation?.kind || '').trim() === 'ai' && activeAiStatusDisplay.visible) {
      return activeAiStatusDisplay.primaryText;
    }
    return typingLine;
  }, [activeAiStatusDisplay, activeConversation?.kind, typingLine]);

  const draftStorageKey = useMemo(
    () => buildChatDraftKey(user?.id, activeConversationId),
    [activeConversationId, user?.id],
  );

  const pinnedMessageStorageKey = useMemo(
    () => buildChatPinnedMessageKey(user?.id, activeConversationId),
    [activeConversationId, user?.id],
  );

  const closeAttachmentPreview = useCallback(() => {
    setAttachmentPreview(null);
  }, []);

  const closeDocumentPreview = useCallback(() => {
    setDocumentPreview((current) => {
      if (current?.objectUrl && typeof window.URL?.revokeObjectURL === 'function') {
        try {
          window.URL.revokeObjectURL(current.objectUrl);
        } catch {
          // Ignore revoke failures on close.
        }
      }
      return null;
    });
  }, []);

  const openDocumentPreview = useCallback(async (messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;

    const mapped = mapChatAttachmentForPreview(attachment);
    setDocumentPreview({
      ...createEmptyAttachmentPreview(),
      open: true,
      loading: true,
      filename: mapped.name,
      contentType: mapped.content_type,
    });

    try {
      const previewState = await buildChatDocumentPreviewState({
        chatAttachmentsAPI,
        messageId: normalizedMessageId,
        attachmentId,
        attachment,
      });
      // #region agent log
      fetch('http://127.0.0.1:7567/ingest/0dd98d48-9716-48e2-8a2d-050e49aa7cea', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '891634' }, body: JSON.stringify({ sessionId: '891634', location: 'Chat.jsx:openDocumentPreview', message: 'chat document preview loaded', data: { messageId: normalizedMessageId, attachmentId, kind: previewState.kind, filename: previewState.filename }, timestamp: Date.now(), runId: 'doc-preview', hypothesisId: 'H-DOC-PREVIEW' }) }).catch(() => {});
      // #endregion
      setDocumentPreview(previewState);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7567/ingest/0dd98d48-9716-48e2-8a2d-050e49aa7cea', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '891634' }, body: JSON.stringify({ sessionId: '891634', location: 'Chat.jsx:openDocumentPreview', message: 'chat document preview failed', data: { messageId: normalizedMessageId, attachmentId, error: String(error?.message || error || '') }, timestamp: Date.now(), runId: 'doc-preview', hypothesisId: 'H-DOC-PREVIEW' }) }).catch(() => {});
      // #endregion
      setDocumentPreview({
        ...createEmptyAttachmentPreview(),
        open: true,
        loading: false,
        error: String(error?.message || 'Не удалось открыть предпросмотр документа.'),
        filename: mapped.name,
        contentType: mapped.content_type,
      });
    }
  }, []);

  const handleDownloadDocumentPreview = useCallback(async () => {
    const ctx = documentPreview?.downloadContext;
    if (!ctx?.messageId || !ctx?.attachmentId) return;
    try {
      const response = await chatAttachmentsAPI.downloadAttachment(ctx.messageId, ctx.attachmentId);
      const { blob, filename } = buildAttachmentBlobPayload({
        response,
        attachment: mapChatAttachmentForPreview(ctx.attachment),
      });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать файл.');
    }
  }, [documentPreview, notifyApiError]);

  const handleDownloadDocumentPreviewPdf = useCallback(async () => {
    const ctx = documentPreview?.downloadContext;
    if (!ctx?.messageId || !ctx?.attachmentId) return;
    try {
      const response = await chatAttachmentsAPI.downloadAttachmentPreviewPdf(ctx.messageId, ctx.attachmentId);
      const { blob, filename } = buildAttachmentBlobPayload({
        response,
        attachment: {
          name: documentPreview?.pdfFilename || `${documentPreview?.filename || 'preview'}.pdf`,
          content_type: 'application/pdf',
        },
      });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать PDF-предпросмотр.');
    }
  }, [documentPreview, notifyApiError]);

  const persistPinnedMessage = useCallback((nextPinnedMessage) => {
    setPinnedMessage(nextPinnedMessage || null);
    writeLocalStorageJsonObject(pinnedMessageStorageKey, nextPinnedMessage || null);
  }, [pinnedMessageStorageKey]);

  const isChatDebugEnabled = useCallback(() => {
    try {
      const raw = String(window.localStorage.getItem(CHAT_DEBUG_STORAGE_KEY) || '').trim().toLowerCase();
      if (!raw) return false;
      return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
    } catch {
      return false;
    }
  }, []);

  const logChatDebug = useCallback((event, details = {}) => {
    if (!isChatDebugEnabled()) return;
    const container = threadScrollRef.current;
    const pendingAnchor = pendingInitialAnchorRef.current;
    const initialViewportGuard = initialViewportGuardRef.current;
    const nextSeq = chatDebugSeqRef.current + 1;
    chatDebugSeqRef.current = nextSeq;
    console.log(`[chat-debug #${nextSeq}] ${event}`, {
      activeConversationId: String(activeConversationIdRef.current || '').trim(),
      autoScrollMode: autoScrollRef.current || false,
      autoScrollMeta: autoScrollMetaRef.current ? {
        source: String(autoScrollMetaRef.current.source || '').trim(),
        userInitiated: Boolean(autoScrollMetaRef.current.userInitiated),
      } : null,
      pendingAnchor: pendingAnchor ? {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
        ready: Boolean(pendingAnchor.ready),
        anchorResolved: Boolean(pendingAnchor.anchorResolved),
        anchorMessageId: String(pendingAnchor.anchorMessageId || '').trim(),
        retryCount: Number(pendingAnchor.retryCount || 0),
        lastAppliedTarget: Number.isFinite(Number(pendingAnchor.lastAppliedTarget))
          ? Number(pendingAnchor.lastAppliedTarget)
          : null,
      } : null,
      scroll: container ? {
        top: Math.round(container.scrollTop),
        height: Math.round(container.scrollHeight),
        clientHeight: Math.round(container.clientHeight),
      } : null,
      transport: {
        socketStatus: String(socketStatusRef.current || '').trim(),
        lastSocketActivityAt: Number(lastSocketActivityAtRef.current || 0),
        state: resolveActiveThreadTransportState({
          activeConversationId: String(activeConversationIdRef.current || '').trim(),
          socketStatus: socketStatusRef.current,
          lastSocketActivityAt: lastSocketActivityAtRef.current,
        }),
        degradedRevalidateCount: Number(degradedThreadRevalidateCountRef.current || 0),
      },
      initialViewportGuard: initialViewportGuard ? {
        conversationId: initialViewportGuard.conversationId,
        mode: initialViewportGuard.mode,
        releaseAt: Number(initialViewportGuard.releaseAt || 0),
        correctionCount: Number(initialViewportGuard.correctionCount || 0),
        lastObservedScrollHeight: Number(initialViewportGuard.lastObservedScrollHeight || 0),
        scrollOpsWithin200ms: Number(initialViewportGuard.scrollOpsWithin200ms || 0),
      } : null,
      ...details,
    });
  }, [isChatDebugEnabled]);
  logChatDebugRef.current = logChatDebug;

  const suppressThreadScrollCancel = useCallback(() => {
    suppressThreadScrollCancelRef.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        suppressThreadScrollCancelRef.current = false;
      });
    });
  }, []);

  const setThreadOverflowAnchorMode = useCallback((mode = '') => {
    const container = threadScrollRef.current;
    if (!container?.style) return;
    container.style.overflowAnchor = String(mode || '').trim();
  }, []);

  const isChatScrollTraceEnabled = useCallback(() => {
    try {
      return window.localStorage.getItem(CHAT_SCROLL_DEBUG_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const clearInitialViewportGuard = useCallback((reason = 'clear') => {
    if (initialViewportGuardTimeoutRef.current) {
      window.clearTimeout(initialViewportGuardTimeoutRef.current);
      initialViewportGuardTimeoutRef.current = null;
    }
    const guard = initialViewportGuardRef.current;
    if (guard) {
      logChatDebug('initialViewportGuard:clear', {
        conversationId: guard.conversationId,
        mode: guard.mode,
        reason,
        correctionCount: Number(guard.correctionCount || 0),
        scrollOpsWithin200ms: Number(guard.scrollOpsWithin200ms || 0),
      });
    }
    initialViewportGuardRef.current = null;
    programmaticScrollHistoryRef.current = [];
    setThreadOverflowAnchorMode('');
  }, [logChatDebug, setThreadOverflowAnchorMode]);

  const isInitialViewportGuardActive = useCallback((conversationId = activeConversationIdRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const guard = initialViewportGuardRef.current;
    if (!normalizedConversationId || !guard || guard.conversationId !== normalizedConversationId) return false;
    if (Date.now() > Number(guard.releaseAt || 0)) {
      clearInitialViewportGuard('expired');
      return false;
    }
    return true;
  }, [clearInitialViewportGuard]);

  const beginInitialViewportGuard = useCallback((conversationId, mode) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) {
      clearInitialViewportGuard('missing_conversation');
      return null;
    }
    if (initialViewportGuardTimeoutRef.current) {
      window.clearTimeout(initialViewportGuardTimeoutRef.current);
      initialViewportGuardTimeoutRef.current = null;
    }
    const now = Date.now();
    initialViewportGuardRef.current = {
      conversationId: normalizedConversationId,
      mode: String(mode || '').trim() || 'bottom_instant',
      startedAt: now,
      releaseAt: now + INITIAL_THREAD_AUTOSCROLL_GUARD_MS,
      correctionCount: 0,
      lastObservedScrollHeight: -1,
      scrollOpsWithin200ms: 0,
    };
    programmaticScrollHistoryRef.current = [];
    setThreadOverflowAnchorMode('none');
    initialViewportGuardTimeoutRef.current = window.setTimeout(() => {
      const currentGuard = initialViewportGuardRef.current;
      if (!currentGuard || currentGuard.conversationId !== normalizedConversationId) return;
      clearInitialViewportGuard('timeout');
    }, INITIAL_THREAD_AUTOSCROLL_GUARD_MS);
    logChatDebug('initialViewportGuard:start', {
      conversationId: normalizedConversationId,
      mode,
      releaseInMs: INITIAL_THREAD_AUTOSCROLL_GUARD_MS,
    });
    return initialViewportGuardRef.current;
  }, [clearInitialViewportGuard, logChatDebug, setThreadOverflowAnchorMode]);

  const traceProgrammaticThreadScroll = useCallback((source, details = {}) => {
    const now = Date.now();
    const nextSource = String(source || '').trim() || 'unknown';
    const guard = initialViewportGuardRef.current;
    const recentHistory = (Array.isArray(programmaticScrollHistoryRef.current) ? programmaticScrollHistoryRef.current : [])
      .filter((entry) => (now - Number(entry?.at || 0)) <= INITIAL_THREAD_SCROLL_TRACE_WINDOW_MS);
    recentHistory.push({ at: now, source: nextSource });
    programmaticScrollHistoryRef.current = recentHistory;
    if (guard) {
      guard.scrollOpsWithin200ms = recentHistory.length;
    }

    const stack = isChatScrollTraceEnabled()
      ? String(new Error().stack || '')
        .split('\n')
        .slice(2, 8)
        .join('\n')
      : '';

    logChatDebug('threadScroll:programmatic', {
      source: nextSource,
      countWithin200ms: recentHistory.length,
      ...details,
      stack: stack || undefined,
    });

    if (stack) {
      console.debug('[chat-scroll-trace]', {
        source: nextSource,
        countWithin200ms: recentHistory.length,
        ...details,
        stack,
      });
    }
  }, [isChatScrollTraceEnabled, logChatDebug]);

  const {
    scheduleThreadViewportStateSync,
    syncThreadViewportState,
  } = useChatThreadViewport({
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
    threadViewportSyncFrameRef,
  });

  const setThreadScrollTop = useCallback((nextScrollTop, { source = 'unknown' } = {}) => {
    const container = threadScrollRef.current;
    if (!container) return false;
    const normalizedScrollTop = Math.max(0, Number.isFinite(Number(nextScrollTop)) ? Number(nextScrollTop) : 0);
    traceProgrammaticThreadScroll(source, {
      nextScrollTop: Math.round(normalizedScrollTop),
      currentScrollTop: Math.round(Number(container.scrollTop || 0)),
      scrollHeight: Math.round(Number(container.scrollHeight || 0)),
      clientHeight: Math.round(Number(container.clientHeight || 0)),
      guardActive: isInitialViewportGuardActive(),
    });
    suppressThreadScrollCancel();
    if (Math.abs(Number(container.scrollTop || 0) - normalizedScrollTop) < 1) {
      syncThreadViewportState(container);
      return true;
    }
    container.scrollTop = normalizedScrollTop;
    syncThreadViewportState(container);
    // #region agent log
    emitAgentDebugLog({
      location: 'Chat.jsx:setThreadScrollTop',
      message: 'scroll write',
      data: {
        source: String(source || ''),
        scrollTop: Math.round(normalizedScrollTop),
        scrollHeight: Math.round(Number(container.scrollHeight || 0)),
        clientHeight: Math.round(Number(container.clientHeight || 0)),
        distanceFromBottom: Math.round(Math.max(0, Number(container.scrollHeight || 0) - normalizedScrollTop - Number(container.clientHeight || 0))),
      },
      hypothesisId: 'H1',
    });
    // #endregion
    return true;
  }, [isInitialViewportGuardActive, suppressThreadScrollCancel, syncThreadViewportState, traceProgrammaticThreadScroll]);

  const bindPinnedScroll = useCallback((scrollFn) => {
    pinnedScrollRef.current = typeof scrollFn === 'function' ? scrollFn : null;
  }, []);

  const scrollThreadToBottomInstant = useCallback(({
    source = 'unknown',
    settleFrames = 0,
    userInitiated = false,
  } = {}) => {
    const pinnedScroll = pinnedScrollRef.current;
    const framesToSettle = Math.max(0, Math.floor(Number(settleFrames || 0)));
    if (typeof pinnedScroll === 'function') {
      threadNearBottomRef.current = true;
      showJumpToLatestRef.current = false;
      setShowJumpToLatest(false);
      pinnedScroll({
        settleFrames: Math.max(0, Math.floor(Number(settleFrames || 0))),
        forcePin: true,
      });
      return true;
    }

    const container = threadScrollRef.current;
    if (!container) return false;

    if (bottomInstantSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomInstantSettleFrameRef.current);
      bottomInstantSettleFrameRef.current = null;
    }

    const conversationId = String(activeConversationIdRef.current || '').trim();
    const scrollToCurrentBottom = (nextSource) => {
      const node = threadScrollRef.current;
      if (!node) return false;
      return setThreadScrollTop(
        Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0)),
        { source: nextSource },
      );
    };

    scrollToCurrentBottom(source);

    if (framesToSettle <= 0) return true;

    let remainingFrames = framesToSettle;
    const settle = () => {
      bottomInstantSettleFrameRef.current = null;
      const node = threadScrollRef.current;
      if (!node) return;
      if (conversationId && conversationId !== String(activeConversationIdRef.current || '').trim()) return;

      const distanceFromBottom = Math.max(
        0,
        Number(node.scrollHeight || 0) - Number(node.scrollTop || 0) - Number(node.clientHeight || 0),
      );
      if (!userInitiated && distanceFromBottom > 160) return;

      scrollToCurrentBottom(`${source}:settle`);
      remainingFrames -= 1;
      if (remainingFrames <= 0) return;
      bottomInstantSettleFrameRef.current = window.requestAnimationFrame(settle);
    };

    bottomInstantSettleFrameRef.current = window.requestAnimationFrame(settle);
    return true;
  }, [setThreadScrollTop]);

  const clearMobileKeyboardSettleTimeouts = useCallback(() => {
    mobileKeyboardSettleTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    mobileKeyboardSettleTimeoutsRef.current = [];
  }, []);

  const scheduleMobileKeyboardBottomSettle = useCallback(({
    conversationId,
    source,
    userInitiated = false,
  } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    clearMobileKeyboardSettleTimeouts();
    [150, 320].forEach((delayMs) => {
      const timeoutId = window.setTimeout(() => {
        mobileKeyboardSettleTimeoutsRef.current = mobileKeyboardSettleTimeoutsRef.current
          .filter((id) => id !== timeoutId);
        if (String(activeConversationIdRef.current || '').trim() !== normalizedConversationId) return;
        scrollThreadToBottomInstant({
          source: `${source}:keyboard-settle-${delayMs}`,
          userInitiated,
          settleFrames: delayMs <= 150 ? 3 : 2,
        });
      }, delayMs);
      mobileKeyboardSettleTimeoutsRef.current.push(timeoutId);
    });
  }, [clearMobileKeyboardSettleTimeouts, scrollThreadToBottomInstant]);

  const scrollThreadBottomIntoView = useCallback(({ source = 'unknown', behavior = 'smooth' } = {}) => {
    const container = threadScrollRef.current;
    if (!container) return false;
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      traceProgrammaticThreadScroll(source, {
        behavior,
        target: 'bottomRef',
        scrollHeight: Math.round(Number(container.scrollHeight || 0)),
        clientHeight: Math.round(Number(container.clientHeight || 0)),
      });
      bottomRef.current.scrollIntoView({ behavior, block: 'end' });
      return true;
    }
    return setThreadScrollTop(container.scrollHeight - container.clientHeight, { source });
  }, [setThreadScrollTop, traceProgrammaticThreadScroll]);

  const queueAutoScroll = useCallback((mode, source, { userInitiated = false } = {}) => {
    const normalizedMode = String(mode || '').trim();
    if (!normalizedMode) {
      autoScrollRef.current = false;
      autoScrollMetaRef.current = null;
      return false;
    }
    const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
    if (!userInitiated && isInitialViewportGuardActive(normalizedConversationId)) {
      logChatDebug('autoScroll:blocked', {
        conversationId: normalizedConversationId,
        mode: normalizedMode,
        source,
      });
      return false;
    }
    autoScrollRef.current = normalizedMode;
    autoScrollMetaRef.current = {
      source: String(source || '').trim() || 'unknown',
      userInitiated,
      requestedAt: Date.now(),
    };
    logChatDebug('autoScroll:queued', {
      conversationId: normalizedConversationId,
      mode: normalizedMode,
      source,
      userInitiated,
    });
    // #region agent log
    emitAgentDebugLog({
      location: 'Chat.jsx:queueAutoScroll',
      message: 'autoScroll queued',
      data: { mode: normalizedMode, source: String(source || ''), userInitiated: Boolean(userInitiated) },
      hypothesisId: 'H1',
    });
    // #endregion
    return true;
  }, [isInitialViewportGuardActive, logChatDebug]);

  const buildPinnedMessagePayload = useCallback((message) => {
    const normalizedMessageId = String(message?.id || '').trim();
    if (!normalizedMessageId) return null;
    return {
      id: normalizedMessageId,
      senderName: String(message?.sender?.full_name || message?.sender?.username || '').trim(),
      preview: String(getMessagePreview(message) || '').trim(),
      createdAt: String(message?.created_at || '').trim(),
    };
  }, []);

  const getInitialScrollMode = useCallback((conversationId, items = conversationsRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return false;
    const conversation = (Array.isArray(items) ? items : []).find((item) => String(item?.id || '').trim() === normalizedConversationId);
    return Number(conversation?.unread_count || 0) > 0 ? 'first_unread_top' : 'bottom_instant';
  }, []);

  const resolveInitialAnchorState = useCallback((items, nextViewerLastReadMessageId, conversationId = activeConversationIdRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const conversation = conversationsRef.current.find((item) => String(item?.id || '').trim() === normalizedConversationId) || null;
    const unreadAnchorId = getUnreadAnchorId(items, nextViewerLastReadMessageId);
    const hasUnreadCounter = Number(conversation?.unread_count || 0) > 0;
    const derivedUnreadCount = countUnreadIncomingAfterMarker(items, nextViewerLastReadMessageId);
    return {
      mode: unreadAnchorId && (hasUnreadCounter || derivedUnreadCount > 0) ? 'first_unread_top' : 'bottom_instant',
      anchorMessageId: unreadAnchorId,
    };
  }, []);

  const resolvePendingInitialAnchorFromPayload = useCallback((conversationId, payload) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!normalizedConversationId || !pendingAnchor || pendingAnchor.conversationId !== normalizedConversationId) {
      return false;
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const nextViewerLastReadMessageId = String(payload?.viewer_last_read_message_id || '').trim();
    const apiAnchorMode = String(payload?.initial_anchor_mode || '').trim();
    const apiAnchorMessageId = String(payload?.initial_anchor_message_id || '').trim();
    const derivedAnchor = resolveInitialAnchorState(items, nextViewerLastReadMessageId, normalizedConversationId);

    // Раньше cached thread открывался сразу, а initial anchor резолвился только после revalidate.
    // Из-за этого браузер успевал один раз нарисовать чат на старой позиции, а затем прыгнуть вниз.
    // Здесь anchor готовится синхронно из уже имеющегося payload, чтобы layout-effect смог поставить
    // scrollTop до первого видимого кадра.
    pendingAnchor.ready = true;
    pendingAnchor.startedAt = Date.now();
    pendingAnchor.mode = apiAnchorMode === 'first_unread'
      ? 'first_unread_top'
      : derivedAnchor.mode;
    pendingAnchor.anchorMessageId = pendingAnchor.mode === 'first_unread_top'
      ? (apiAnchorMessageId || derivedAnchor.anchorMessageId)
      : derivedAnchor.anchorMessageId;
    pendingAnchor.anchorResolved = true;
    pendingAnchor.lastAppliedTarget = null;
    logChatDebug('pendingAnchor:resolved', {
      conversationId: normalizedConversationId,
      mode: pendingAnchor.mode,
      anchorMessageId: pendingAnchor.anchorMessageId || null,
      source: apiAnchorMode ? 'payload' : 'derived',
    });
    return true;
  }, [logChatDebug, resolveInitialAnchorState]);

  const clearPendingInitialAnchorSettleTimer = useCallback(() => {
    if (pendingInitialAnchorSettleTimeoutRef.current) {
      window.clearTimeout(pendingInitialAnchorSettleTimeoutRef.current);
      pendingInitialAnchorSettleTimeoutRef.current = null;
    }
  }, []);

  const clearPendingInitialAnchorRetryTimer = useCallback(() => {
    if (pendingInitialAnchorRetryTimeoutRef.current) {
      window.clearTimeout(pendingInitialAnchorRetryTimeoutRef.current);
      pendingInitialAnchorRetryTimeoutRef.current = null;
    }
  }, []);

  const clearPendingInitialAnchorResizeFrame = useCallback(() => {
    if (pendingInitialAnchorResizeFrameRef.current) {
      window.cancelAnimationFrame(pendingInitialAnchorResizeFrameRef.current);
      pendingInitialAnchorResizeFrameRef.current = null;
    }
  }, []);

  const cancelPendingInitialAnchor = useCallback(() => {
    pendingInitialAnchorRef.current = null;
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    clearPendingInitialAnchorResizeFrame();
    clearInitialViewportGuard('pending_anchor_cancel');
  }, [clearInitialViewportGuard, clearPendingInitialAnchorResizeFrame, clearPendingInitialAnchorRetryTimer, clearPendingInitialAnchorSettleTimer]);
  cancelPendingInitialAnchorRef.current = cancelPendingInitialAnchor;

  const queueInitialThreadPosition = useCallback((conversationId, items = conversationsRef.current) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const nextMode = getInitialScrollMode(normalizedConversationId, items);
    logChatDebug('queueInitialThreadPosition', {
      conversationId: normalizedConversationId,
      nextMode: nextMode || false,
    });
    autoScrollRef.current = false;
    if (!normalizedConversationId || !nextMode) {
      cancelPendingInitialAnchor();
      return false;
    }
    beginInitialViewportGuard(normalizedConversationId, nextMode);
    autoScrollMetaRef.current = null;
    if (threadScrollRef.current) {
      setThreadScrollTop(0, { source: 'queueInitialThreadPosition:reset' });
      threadNearBottomRef.current = false;
      showJumpToLatestRef.current = false;
      setShowJumpToLatest(false);
    }
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    pendingInitialAnchorRef.current = {
      conversationId: normalizedConversationId,
      mode: nextMode,
      startedAt: Date.now(),
      lastAppliedTarget: null,
      ready: false,
      anchorResolved: nextMode !== 'first_unread_top',
      anchorMessageId: '',
      retryCount: 0,
    };
    return nextMode;
  }, [beginInitialViewportGuard, cancelPendingInitialAnchor, clearPendingInitialAnchorRetryTimer, clearPendingInitialAnchorSettleTimer, getInitialScrollMode, logChatDebug, setThreadScrollTop]);
  queueInitialThreadPositionRef.current = queueInitialThreadPosition;

  const applyPendingInitialAnchor = useCallback(({ source = 'pendingAnchor' } = {}) => {
    const pendingAnchor = pendingInitialAnchorRef.current;
    const container = threadScrollRef.current;
    if (!pendingAnchor || !container) return false;
    if (pendingAnchor.conversationId !== activeConversationIdRef.current) return false;
    if (!pendingAnchor.ready) return false;
    if (Number(container.clientHeight || 0) <= 0 && Number(container.scrollHeight || 0) <= 0) {
      return false;
    }
    if ((Date.now() - Number(pendingAnchor.startedAt || 0)) > INITIAL_THREAD_POSITION_MAX_MS) {
      logChatDebug('pendingAnchor:expired', {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
      });
      cancelPendingInitialAnchor();
      return false;
    }

    let nextScrollTop = null;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

    if (pendingAnchor.mode === 'first_unread_top') {
      if (!pendingAnchor.anchorResolved) {
        if (messagesRef.current.length === 0) return false;
        pendingAnchor.anchorMessageId = getUnreadAnchorId(messagesRef.current, viewerLastReadMessageId);
        pendingAnchor.anchorResolved = true;
      }

      const unreadAnchorId = String(pendingAnchor.anchorMessageId || '').trim();
      if (unreadAnchorId) {
        const selector = `[data-chat-message-id="${unreadAnchorId}"]`;
        const target = container.querySelector?.(selector);
        if (target) {
          nextScrollTop = Math.max(0, target.offsetTop - FIRST_UNREAD_TOP_PADDING);
        } else {
          return false;
        }
      }
      if (pendingAnchor.anchorResolved && nextScrollTop === null) {
        nextScrollTop = maxScrollTop;
      }
    } else if (pendingAnchor.mode === 'bottom_instant') {
      nextScrollTop = maxScrollTop;
    }

    if (nextScrollTop === null) return false;

    const previousTarget = Number(pendingAnchor.lastAppliedTarget);
    const currentScrollTop = Number(container.scrollTop || 0);
    if (
      Number.isFinite(previousTarget)
      && Math.abs(previousTarget - nextScrollTop) < 1
      && Math.abs(currentScrollTop - nextScrollTop) < 1
    ) {
      const initialViewportGuard = initialViewportGuardRef.current;
      if (initialViewportGuard?.conversationId === pendingAnchor.conversationId) {
        initialViewportGuard.lastObservedScrollHeight = Math.round(Number(container.scrollHeight || 0));
      }
      syncThreadViewportState(container);
      logChatDebug('pendingAnchor:unchanged', {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
        currentScrollTop: Math.round(currentScrollTop),
        nextScrollTop: Math.round(nextScrollTop),
      });
      return 'unchanged';
    }

    pendingAnchor.lastAppliedTarget = nextScrollTop;
    setThreadScrollTop(nextScrollTop, {
      source: `pendingAnchor:${source}`,
    });
    const initialViewportGuard = initialViewportGuardRef.current;
    if (initialViewportGuard?.conversationId === pendingAnchor.conversationId) {
      initialViewportGuard.correctionCount = Number(initialViewportGuard.correctionCount || 0) + 1;
      initialViewportGuard.lastObservedScrollHeight = Math.round(Number(container.scrollHeight || 0));
    }
    logChatDebug('pendingAnchor:applied', {
      conversationId: pendingAnchor.conversationId,
      mode: pendingAnchor.mode,
      nextScrollTop: Math.round(nextScrollTop),
      source,
    });
    return 'changed';
  }, [cancelPendingInitialAnchor, logChatDebug, setThreadScrollTop, syncThreadViewportState, viewerLastReadMessageId]);

  const schedulePendingInitialAnchorSettle = useCallback((reset = false) => {
    if (pendingInitialAnchorSettleTimeoutRef.current && !reset) return;
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!pendingAnchor) return;
    const conversationId = pendingAnchor.conversationId;
    pendingInitialAnchorSettleTimeoutRef.current = window.setTimeout(() => {
      const currentPendingAnchor = pendingInitialAnchorRef.current;
      if (!currentPendingAnchor) return;
      if (currentPendingAnchor.conversationId !== conversationId) return;
      if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
      logChatDebug('pendingAnchor:settled', {
        conversationId,
        mode: currentPendingAnchor.mode,
      });
      pendingInitialAnchorRef.current = null;
      pendingInitialAnchorSettleTimeoutRef.current = null;
    }, INITIAL_THREAD_POSITION_SETTLE_MS);
  }, [clearPendingInitialAnchorRetryTimer, clearPendingInitialAnchorSettleTimer, logChatDebug]);

  const schedulePendingInitialAnchorRetry = useCallback(() => {
    clearPendingInitialAnchorRetryTimer();
    const pendingAnchor = pendingInitialAnchorRef.current;
    if (!pendingAnchor) return;
    if (Number(pendingAnchor.retryCount || 0) >= 1) return;
    const conversationId = pendingAnchor.conversationId;
    pendingInitialAnchorRetryTimeoutRef.current = window.setTimeout(() => {
      pendingInitialAnchorRetryTimeoutRef.current = null;
      const currentPendingAnchor = pendingInitialAnchorRef.current;
      if (!currentPendingAnchor) return;
      if (currentPendingAnchor.conversationId !== conversationId) return;
      if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
      currentPendingAnchor.retryCount = Number(currentPendingAnchor.retryCount || 0) + 1;
      logChatDebug('pendingAnchor:retry', {
        conversationId,
        mode: currentPendingAnchor.mode,
        retryCount: currentPendingAnchor.retryCount,
      });
      const retryResult = applyPendingInitialAnchor({ source: 'settle_retry' });
      if (retryResult === 'changed') {
        schedulePendingInitialAnchorSettle(true);
        return;
      }
      if (retryResult === 'unchanged') {
        schedulePendingInitialAnchorSettle(false);
        return;
      }
      logChatDebug('pendingAnchor:retrySkipped', {
        conversationId,
        mode: currentPendingAnchor.mode,
        reason: 'dom_not_stable',
      });
    }, INITIAL_THREAD_POSITION_SETTLE_MS);
  }, [applyPendingInitialAnchor, clearPendingInitialAnchorRetryTimer, logChatDebug, schedulePendingInitialAnchorSettle]);

  const hasPendingInitialAnchorForConversation = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return false;
    return pendingInitialAnchorRef.current?.conversationId === normalizedConversationId;
  }, []);

  const capturePrependScrollRestore = useCallback(() => {
    const container = threadScrollRef.current;
    if (!container) return null;
    const messageNodes = Array.from(container.querySelectorAll('[data-chat-message-id]'));
    const anchorNode = messageNodes.find((node) => (
      Number(node.offsetTop || 0) + Number(node.offsetHeight || 0) >= Number(container.scrollTop || 0)
    )) || messageNodes[0] || null;

    return {
      scrollHeight: Number(container.scrollHeight || 0),
      scrollTop: Number(container.scrollTop || 0),
      anchorMessageId: String(anchorNode?.getAttribute?.('data-chat-message-id') || '').trim(),
      anchorTop: Number(anchorNode?.offsetTop || 0),
    };
  }, []);

  const openAttachmentPreview = useCallback((messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;
    const sourceMessage = messagesRef.current.find((item) => String(item?.id || '').trim() === normalizedMessageId);
    const senderName = String(
      sourceMessage?.sender?.full_name
      || sourceMessage?.sender?.username
      || '',
    ).trim();
    const variantUrls = attachment?.variant_urls || {};
    const inlineOriginalUrl = buildAttachmentUrl(normalizedMessageId, attachmentId, { inline: true });
    const originalUrl = normalizeChatAttachmentUrl(attachment?.original_url || attachment?.originalUrl)
      || inlineOriginalUrl
      || buildAttachmentUrl(normalizedMessageId, attachmentId);
    const previewUrl = normalizeChatAttachmentUrl(
      attachment?.preview_url
      || attachment?.previewUrl
      || variantUrls.preview
      || variantUrls.thumb,
    ) || originalUrl;
    setAttachmentPreview({
      messageId: normalizedMessageId,
      attachment: {
        ...attachment,
        id: attachmentId,
        file_name: String(attachment?.file_name || '').trim() || 'Изображение',
        file_size: Number(attachment?.file_size || 0),
      },
      fileUrl: originalUrl,
      previewUrl,
      originalUrl,
      posterUrl: normalizeChatAttachmentUrl(attachment?.poster_url || attachment?.posterUrl || variantUrls.poster),
      senderName,
      createdAt: String(sourceMessage?.created_at || '').trim(),
      activeIndex: 0,
      totalCount: 1,
    });
  }, []);

  const openMediaViewer = useCallback((messageId, attachment) => {
    void loadChatDialogsModule();
    const normalizedMessageId = String(messageId || '').trim();
    const attachmentId = String(attachment?.id || '').trim();
    if (!normalizedMessageId || !attachmentId) return;

    const normalizePreviewAttachment = (item) => {
      const normalizedItemId = String(item?.id || '').trim();
      if (!normalizedItemId) return null;
      const variantUrls = item?.variant_urls || {};
      const localBlobUrl = pickBlobAttachmentUrl(
        item?.preview_url,
        item?.previewUrl,
        item?.original_url,
        item?.originalUrl,
        item?.open_url,
        item?.openUrl,
        variantUrls.preview,
        variantUrls.thumb,
      );
      const inlineOriginalUrl = buildAttachmentUrl(normalizedMessageId, normalizedItemId, { inline: true });
      const originalUrl = localBlobUrl
        || normalizeChatAttachmentUrl(item?.original_url || item?.originalUrl)
        || inlineOriginalUrl
        || buildAttachmentUrl(normalizedMessageId, normalizedItemId);
      const previewUrl = localBlobUrl
        || normalizeChatAttachmentUrl(
          item?.preview_url
          || item?.previewUrl
          || variantUrls.preview
          || variantUrls.thumb,
        )
        || originalUrl;
      return {
        ...item,
        id: normalizedItemId,
        file_name: String(item?.file_name || '').trim() || 'Вложение',
        file_size: Number(item?.file_size || 0),
        mime_type: String(item?.mime_type || '').trim(),
        fileUrl: originalUrl,
        previewUrl,
        originalUrl,
        posterUrl: normalizeChatAttachmentUrl(item?.poster_url || item?.posterUrl || variantUrls.poster),
      };
    };

    const normalizedAttachment = normalizePreviewAttachment(attachment);
    if (!normalizedAttachment) return;
    if (!isMediaAttachment(normalizedAttachment)) {
      if (isChatDocumentPreviewableAttachment(normalizedAttachment)) {
        void openDocumentPreview(normalizedMessageId, attachment);
        return;
      }
      const openUrl = normalizeChatAttachmentUrl(
        normalizedAttachment?.open_url
        || normalizedAttachment?.openUrl
        || normalizedAttachment?.originalUrl,
      )
        || buildAttachmentUrl(normalizedMessageId, attachmentId, { inline: true });
      window.open(openUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const sourceMessage = messagesRef.current.find((item) => String(item?.id || '').trim() === normalizedMessageId);
    const senderName = String(
      sourceMessage?.sender?.full_name
      || sourceMessage?.sender?.username
      || '',
    ).trim();
    const mediaItems = (Array.isArray(sourceMessage?.attachments) ? sourceMessage.attachments : [])
      .map(normalizePreviewAttachment)
      .filter(Boolean)
      .filter(isMediaAttachment);
    const previewItems = mediaItems.length > 0 ? mediaItems : [normalizedAttachment];
    const activeIndex = Math.max(0, previewItems.findIndex((item) => item.id === attachmentId));
    const activeAttachment = previewItems[activeIndex] || normalizedAttachment;

    const isProcessing = isSendingOptimisticThreadMessage(sourceMessage, activeConversationIdRef.current)
      || String(sourceMessage?.delivery_status || '').trim() === 'sending';

    setAttachmentPreview({
      messageId: normalizedMessageId,
      attachment: activeAttachment,
      fileUrl: activeAttachment.originalUrl || activeAttachment.fileUrl,
      previewUrl: activeAttachment.previewUrl || activeAttachment.fileUrl,
      originalUrl: activeAttachment.originalUrl || activeAttachment.fileUrl,
      posterUrl: activeAttachment.posterUrl || '',
      items: previewItems,
      activeIndex,
      totalCount: previewItems.length,
      senderName,
      createdAt: String(sourceMessage?.created_at || '').trim(),
      kind: isVideoAttachment(activeAttachment) ? 'video' : 'image',
      startedFromGallery: previewItems.length > 1,
      isProcessing,
    });
  }, [openDocumentPreview]);

  const openTaskFromChat = useCallback((taskId) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return;
    navigate(`/tasks?task=${encodeURIComponent(normalizedTaskId)}`);
  }, [navigate]);

  const emitChatUnreadRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
    window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
  }, []);

  const highlightMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;
    setHighlightedMessageId(normalizedMessageId);
    if (highlightResetTimeoutRef.current) {
      window.clearTimeout(highlightResetTimeoutRef.current);
    }
    highlightResetTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === normalizedMessageId ? '' : current));
    }, 2600);
  }, []);

  const scrollToMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return false;
    cancelPendingInitialAnchor();
    const selector = `[data-chat-message-id="${normalizedMessageId}"]`;
    const target = threadScrollRef.current?.querySelector?.(selector);
    if (!target) return false;
    traceProgrammaticThreadScroll('scrollToMessage', {
      messageId: normalizedMessageId,
      behavior: 'smooth',
      block: 'center',
    });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightMessage(normalizedMessageId);
    return true;
  }, [cancelPendingInitialAnchor, highlightMessage, traceProgrammaticThreadScroll]);

  useLayoutEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const normalizedActiveId = String(activeConversationId || '').trim();
    window.dispatchEvent(new CustomEvent('chat-active-conversation-changed', {
      detail: { conversationId: normalizedActiveId },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('chat-active-conversation-changed', {
        detail: { conversationId: '' },
      }));
    };
  }, [activeConversationId]);

  useEffect(() => {
    setAttachmentPreview(null);
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
  }, [activeConversationId]);

  conversationsRef.current = conversations;
  conversationsLoadingRef.current = conversationsLoading;
  aiBotsLoadingRef.current = aiBotsLoading;
  messagesRef.current = messages;
  messagesLoadingRef.current = messagesLoading;
  messagesHasMoreRef.current = messagesHasMore;
  messagesHasNewerRef.current = messagesHasNewer;

  useEffect(() => {
    if (!conversationsCacheHydratedRef.current) return;
    setSWRCache(conversationsCacheKeyParts, { items: conversations });
  }, [conversations, conversationsCacheKeyParts]);

  useEffect(() => {
    if (!canUseAiChat || !aiBotsCacheHydratedRef.current) return;
    setSWRCache(aiBotsCacheKeyParts, { items: aiBots });
  }, [aiBots, aiBotsCacheKeyParts, canUseAiChat]);

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!normalizedConversationId) return;
    if (hydratedThreadConversationIdRef.current !== normalizedConversationId) return;
    setSWRCache(
      buildChatThreadCacheKeyParts(userCacheId, normalizedConversationId),
      {
        items: messages,
        has_more: messagesHasMore,
        has_older: messagesHasMore,
        has_newer: messagesHasNewer,
        viewer_last_read_message_id: viewerLastReadMessageId,
        viewer_last_read_at: viewerLastReadAt,
      },
    );
  }, [activeConversationId, messages, messagesHasMore, messagesHasNewer, userCacheId, viewerLastReadAt, viewerLastReadMessageId]);

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    try {
      if (normalizedConversationId) {
        window.sessionStorage.setItem(lastConversationSessionKey, normalizedConversationId);
      } else {
        window.sessionStorage.removeItem(lastConversationSessionKey);
      }
    } catch {
      // Ignore browser storage failures for chat session restore.
    }
  }, [activeConversationId, lastConversationSessionKey]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(lastMobileViewSessionKey, mobileView === 'thread' ? 'thread' : 'inbox');
    } catch {
      // Ignore browser storage failures for chat session restore.
    }
  }, [lastMobileViewSessionKey, mobileView]);

  useEffect(() => {
    if (!isMobile) {
      mobileHistoryReadyRef.current = false;
      mobileHistoryModeRef.current = 'inbox:closed:none';
      return;
    }
    if (mobileHistoryReadyRef.current || typeof window === 'undefined') return;

    const existingState = readMobileHistoryState();
    if (existingState) {
      mobileHistoryReadyRef.current = true;
      mobileHistoryModeRef.current = getMobileHistoryKey(
        existingState,
        existingState.view === 'thread' ? getCurrentBrowserConversationId() : '',
      );
      return;
    }

    writeMobileHistoryState({ view: 'inbox', drawerOpen: false, infoOpen: false }, 'replace');
    if (resolvedMobileView === 'thread') {
      writeMobileHistoryState({ view: 'thread', drawerOpen: false, infoOpen: false }, 'push', activeConversationId);
    }
    mobileHistoryReadyRef.current = true;
  }, [activeConversationId, getCurrentBrowserConversationId, getMobileHistoryKey, isMobile, readMobileHistoryState, resolvedMobileView, writeMobileHistoryState]);

  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return;
    const handlePopState = (event) => {
      const nextState = readMobileHistoryState(event.state);
      if (!nextState) return;
      const previousState = {
        view: resolvedMobileView === 'thread' ? 'thread' : 'inbox',
        drawerOpen: false,
        infoOpen,
      };
      const nextConversationId = nextState.view === 'thread'
        ? getCurrentBrowserConversationId()
        : '';
      mobileHistoryModeRef.current = getMobileHistoryKey(nextState, nextConversationId);

      if (previousState.view !== nextState.view) {
        setMobileTransitionDirection(nextState.view === 'thread' ? 1 : -1);
      }
      setInfoOpen(nextState.view === 'thread' && Boolean(nextState.infoOpen));
      if (nextState.view === 'thread') {
        if (!nextConversationId) {
          setActiveConversationId('');
          setMobileView('inbox');
          setInfoOpen(false);
          closeDrawer?.();
          return;
        }
        if (activeConversationIdRef.current !== nextConversationId) {
          setActiveConversationId(nextConversationId);
        }
      } else if (activeConversationIdRef.current) {
        setActiveConversationId('');
      }
      setMobileView(nextState.view);
      closeDrawer?.();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [closeDrawer, getCurrentBrowserConversationId, getMobileHistoryKey, infoOpen, isMobile, readMobileHistoryState, resolvedMobileView]);

  useEffect(() => () => {
    if (highlightResetTimeoutRef.current) {
      window.clearTimeout(highlightResetTimeoutRef.current);
    }
    if (threadViewportSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(threadViewportSyncFrameRef.current);
      threadViewportSyncFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStartedRef.current = false;
    typingParticipantsTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    typingParticipantsTimeoutsRef.current.clear();
  }, []);

  useEffect(() => () => {
    clearPendingInitialAnchorSettleTimer();
    clearPendingInitialAnchorRetryTimer();
    clearPendingInitialAnchorResizeFrame();
    clearInitialViewportGuard('unmount');
  }, [clearInitialViewportGuard, clearPendingInitialAnchorResizeFrame, clearPendingInitialAnchorRetryTimer, clearPendingInitialAnchorSettleTimer]);

  useEffect(() => {
    const contentNode = threadContentRef.current;
    if (!contentNode || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      const pendingAnchor = pendingInitialAnchorRef.current;
      if (!pendingAnchor?.ready) return;
      if (pendingAnchor.conversationId !== activeConversationIdRef.current) return;
      if (!isInitialViewportGuardActive(pendingAnchor.conversationId)) return;
      if (threadNearBottomRef.current) return;

      const container = threadScrollRef.current;
      if (!container) return;
      const nextScrollHeight = Math.round(Number(container.scrollHeight || 0));
      const initialViewportGuard = initialViewportGuardRef.current;
      if (initialViewportGuard && initialViewportGuard.lastObservedScrollHeight === nextScrollHeight) return;

      clearPendingInitialAnchorResizeFrame();
      pendingInitialAnchorResizeFrameRef.current = window.requestAnimationFrame(() => {
        pendingInitialAnchorResizeFrameRef.current = null;
        queueMicrotask(() => {
          const currentPendingAnchor = pendingInitialAnchorRef.current;
          if (!currentPendingAnchor?.ready) return;
          if (currentPendingAnchor.conversationId !== activeConversationIdRef.current) return;
          if (!isInitialViewportGuardActive(currentPendingAnchor.conversationId)) return;
          const resizeResult = applyPendingInitialAnchor({ source: 'resize_observer' });
          if (resizeResult === 'changed') {
            logChatDebug('pendingAnchor:resizeChanged', {
              conversationId: currentPendingAnchor.conversationId,
              mode: currentPendingAnchor.mode,
              scrollHeight: nextScrollHeight,
            });
            schedulePendingInitialAnchorSettle(true);
            return;
          }
          if (resizeResult === 'unchanged') {
            schedulePendingInitialAnchorSettle(false);
            return;
          }
          schedulePendingInitialAnchorRetry();
        });
      });
    });

    observer.observe(contentNode);
    return () => {
      observer.disconnect();
      clearPendingInitialAnchorResizeFrame();
    };
  }, [activeConversationId, applyPendingInitialAnchor, clearPendingInitialAnchorResizeFrame, isInitialViewportGuardActive, logChatDebug, schedulePendingInitialAnchorRetry, schedulePendingInitialAnchorSettle]);

  const focusComposer = useCallback((options = {}) => {
    const forceMobile = Boolean(options?.forceMobile);
    if (isMobile && !forceMobile) return;
    window.requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node?.focus) return;
      if (typeof document !== 'undefined' && document.activeElement === node) return;
      try {
        node.focus({ preventScroll: true });
      } catch {
        node.focus();
      }
    });
  }, [isMobile]);
  focusComposerRef.current = focusComposer;

  const syncConversationPreview = useCallback((conversationId, lastMessage, overrides = {}) => {
    const id = String(conversationId || '').trim();
    if (!id || !lastMessage) return;
    setConversations((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            last_message_at: lastMessage?.created_at || item.last_message_at,
            updated_at: lastMessage?.created_at || item.updated_at,
            last_message_preview: getMessagePreview(lastMessage),
            ...overrides,
          }
        : item
    )));
  }, []);

  const syncConversationUnreadState = useCallback((conversationId, readMessageId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedReadMessageId = String(readMessageId || '').trim();
    if (!normalizedConversationId) return;
    const nextUnreadCount = countUnreadIncomingAfterMarker(messagesRef.current, normalizedReadMessageId);
    setConversations((current) => current.map((item) => (
      item.id === normalizedConversationId
        ? {
            ...item,
            unread_count: nextUnreadCount,
          }
        : item
    )));
  }, []);

  const buildReplyPreview = useCallback((message) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId) return null;
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const kind = message?.kind === 'task_share'
      ? 'task_share'
      : (message?.kind === 'file' || attachments.length > 0 ? 'file' : 'text');
    const senderName = String(message?.sender?.full_name || message?.sender?.username || '').trim() || 'Сообщение';
    const body = String(message?.body || '').trim();
    const taskTitle = String(message?.task_preview?.title || '').trim();
    return {
      id: messageId,
      sender_name: senderName,
      kind,
      body,
      task_title: taskTitle || undefined,
      attachments_count: attachments.length,
    };
  }, []);

  const withStableMessageRenderKey = useCallback((message, existingMessage = null) => {
    return withPreservedThreadRenderKey(message, existingMessage);
  }, []);

  const isLikelyOptimisticReplacement = useCallback((optimisticMessage, serverMessage) => {
    if (!optimisticMessage?.id || !serverMessage?.id) return false;
    if (!optimisticMessage?.isOptimistic) return false;
    if (String(optimisticMessage?.optimisticStatus || '').trim() !== 'sending') return false;
    if (!serverMessage?.is_own) return false;
    if (String(optimisticMessage?.conversation_id || '').trim() !== String(serverMessage?.conversation_id || '').trim()) {
      return false;
    }
    if (String(optimisticMessage?.kind || 'text').trim() !== String(serverMessage?.kind || 'text').trim()) {
      return false;
    }

    const optimisticClientMessageId = String(optimisticMessage?.client_message_id || '').trim();
    const serverClientMessageId = String(serverMessage?.client_message_id || '').trim();
    if (optimisticClientMessageId && serverClientMessageId) {
      return optimisticClientMessageId === serverClientMessageId;
    }

    const optimisticReplyId = String(optimisticMessage?.reply_preview?.id || '').trim();
    const serverReplyId = String(
      serverMessage?.reply_preview?.id
      || serverMessage?.reply_to_message_id
      || ''
    ).trim();
    if (optimisticReplyId && serverReplyId && optimisticReplyId !== serverReplyId) {
      return false;
    }

    const optimisticBody = String(optimisticMessage?.body || '').trim();
    const serverBody = String(serverMessage?.body || '').trim();
    if (optimisticBody !== serverBody) return false;

    const optimisticAttachments = Array.isArray(optimisticMessage?.attachments) ? optimisticMessage.attachments : [];
    const serverAttachments = Array.isArray(serverMessage?.attachments) ? serverMessage.attachments : [];
    if (optimisticAttachments.length !== serverAttachments.length) return false;
    if (optimisticAttachments.length > 0) {
      const optimisticNames = optimisticAttachments.map((item) => String(item?.file_name || '').trim()).join('|');
      const serverNames = serverAttachments.map((item) => String(item?.file_name || '').trim()).join('|');
      if (optimisticNames && serverNames && optimisticNames !== serverNames) return false;
    }

    const optimisticCreatedAt = Date.parse(String(optimisticMessage?.created_at || ''));
    const serverCreatedAt = Date.parse(String(serverMessage?.created_at || ''));
    if (Number.isFinite(optimisticCreatedAt) && Number.isFinite(serverCreatedAt)) {
      return Math.abs(serverCreatedAt - optimisticCreatedAt) <= 30_000;
    }

    return true;
  }, []);

  const createOptimisticTextMessage = useCallback(({ conversationId, body, bodyFormat = 'plain', replyPreview }) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedBody = String(body || '').trim();
    if (!normalizedConversationId || !normalizedBody) return null;
    const normalizedBodyFormat = String(bodyFormat || '').trim() === 'markdown' ? 'markdown' : 'plain';
    optimisticMessageSeqRef.current += 1;
    const optimisticId = `optimistic:${normalizedConversationId}:${Date.now()}:${optimisticMessageSeqRef.current}`;
    const clientMessageId = `chat-client:${normalizedConversationId}:${Date.now()}:${optimisticMessageSeqRef.current}`;
    return {
      id: optimisticId,
      conversation_id: normalizedConversationId,
      client_message_id: clientMessageId,
      kind: 'text',
      sender: {
        id: Number(user?.id || 0) || user?.id || 0,
        username: String(user?.username || '').trim(),
        full_name: String(user?.full_name || user?.username || '').trim() || null,
      },
      body: normalizedBody,
      body_format: normalizedBodyFormat,
      created_at: new Date().toISOString(),
      is_own: true,
      delivery_status: 'sending',
      read_by_count: 0,
      reply_preview: replyPreview || null,
      task_preview: null,
      attachments: [],
      isOptimistic: true,
      optimisticStatus: 'sending',
      renderKey: optimisticId,
    };
  }, [user?.full_name, user?.id, user?.username]);

  const revokeObjectUrls = useCallback((urls) => {
    if (!Array.isArray(urls) || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
    urls.forEach((value) => {
      const normalizedValue = String(value || '').trim();
      if (!normalizedValue) return;
      try {
        URL.revokeObjectURL(normalizedValue);
      } catch {
        // Ignore object URL cleanup failures.
      }
    });
  }, []);

  const createOptimisticFileMessage = useCallback(({
    conversationId,
    files,
    body,
    replyPreview,
  }) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const sourceFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!normalizedConversationId || sourceFiles.length === 0) return null;
    optimisticMessageSeqRef.current += 1;
    const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    const objectUrls = [];
    const attachments = sourceFiles.map((file, index) => {
      const objectUrl = canCreateObjectUrl ? URL.createObjectURL(file) : '';
      if (objectUrl) objectUrls.push(objectUrl);
      return {
        id: `optimistic-attachment:${Date.now()}:${optimisticMessageSeqRef.current}:${index + 1}`,
        file_name: String(file?.name || '').trim() || `file-${index + 1}`,
        file_size: Number(file?.size || 0),
        mime_type: String(file?.type || '').trim() || 'application/octet-stream',
        original_url: objectUrl,
        open_url: objectUrl,
        preview_url: objectUrl,
        poster_url: '',
        ...(String(file?.type || '').startsWith('image/')
          ? { width: 216, height: 176 }
          : {}),
      };
    });
    const optimisticId = `optimistic:${normalizedConversationId}:file:${Date.now()}:${optimisticMessageSeqRef.current}`;
    return {
      id: optimisticId,
      conversation_id: normalizedConversationId,
      kind: 'file',
      sender: {
        id: Number(user?.id || 0) || user?.id || 0,
        username: String(user?.username || '').trim(),
        full_name: String(user?.full_name || user?.username || '').trim() || null,
      },
      body: String(body || '').trim(),
      created_at: new Date().toISOString(),
      is_own: true,
      delivery_status: 'sending',
      read_by_count: 0,
      reply_preview: replyPreview || null,
      task_preview: null,
      attachments,
      isOptimistic: true,
      optimisticStatus: 'sending',
      uploadProgress: 0,
      optimisticObjectUrls: objectUrls,
      renderKey: optimisticId,
    };
  }, [user?.full_name, user?.id, user?.username]);

  const upsertThreadMessages = useCallback((incomingMessages, { replaceByMessageId = null } = {}) => {
    const sourceMessages = (Array.isArray(incomingMessages) ? incomingMessages : [incomingMessages])
      .filter((message) => {
        const normalizedConversationId = String(message?.conversation_id || '').trim();
        return message?.id && normalizedConversationId && normalizedConversationId === activeConversationIdRef.current;
      });
    if (sourceMessages.length === 0) return;
    const replacementMap = replaceByMessageId instanceof Map ? replaceByMessageId : new Map();
    setMessages((current) => {
      let next = [...current];
      let changed = false;

      sourceMessages.forEach((message) => {
        const messageId = String(message?.id || '').trim();
        const normalizedReplaceId = String(replacementMap.get(messageId) || '').trim();
        if (!messageId) return;

        const existingIndex = next.findIndex((item) => {
          const itemId = String(item?.id || '').trim();
          return itemId === messageId || (normalizedReplaceId && itemId === normalizedReplaceId);
        });

        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          const nextMessage = withStableMessageRenderKey(message, existing);
          if (!areThreadMessagesEquivalent(existing, nextMessage)) {
            next[existingIndex] = nextMessage;
            changed = true;
          }
          if (String(existing?.id || '').trim() !== messageId) {
            changed = true;
          }
          if (normalizedReplaceId) {
            const beforeLength = next.length;
            next = next.filter((item, index) => (
              index === existingIndex || String(item?.id || '').trim() !== normalizedReplaceId
            ));
            if (next.length !== beforeLength) changed = true;
          }
          return;
        }

        next.push(withStableMessageRenderKey(message));
        changed = true;
      });

      const ordered = sortThreadMessages(next);
      if (!changed && ordered.length === current.length) {
        for (let index = 0; index < ordered.length; index += 1) {
          if (ordered[index] !== current[index]) {
            changed = true;
            break;
          }
        }
      }
      return changed ? ordered : current;
    });
  }, [withStableMessageRenderKey]);

  const upsertThreadMessage = useCallback((message, { replaceId = '' } = {}) => {
    if (!message?.id) return;
    const messageId = String(message.id || '').trim();
    const normalizedReplaceId = String(replaceId || '').trim();
    const replaceByMessageId = normalizedReplaceId && messageId
      ? new Map([[messageId, normalizedReplaceId]])
      : null;
    upsertThreadMessages([message], { replaceByMessageId });
  }, [upsertThreadMessages]);

  const patchThreadMessage = useCallback((messageId, patch) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId || !patch || typeof patch !== 'object') return;
    setMessages((current) => current.map((item) => (
      String(item?.id || '').trim() === normalizedMessageId
        ? { ...item, ...patch }
        : item
    )));
  }, []);

  const promoteConversationToTop = useCallback(() => {
    setConversations((current) => sortSidebarConversations(current));
  }, []);

  const upsertConversation = useCallback((conversation, { promote = false } = {}) => {
    if (!conversation?.id) return;
    const normalizedConversationId = String(conversation.id).trim();
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === normalizedConversationId);
      const next = index >= 0
        ? current.map((item) => (item.id === normalizedConversationId ? conversation : item))
        : [conversation, ...current];
      return sortSidebarConversations(next);
    });
    upsertSearchConversation(conversation);
    setConversationDetailsById((current) => {
      const existing = current[normalizedConversationId];
      if (!existing) return current;
      return {
        ...current,
        [normalizedConversationId]: {
          ...existing,
          ...conversation,
          member_preview: Array.isArray(conversation?.member_preview)
            ? conversation.member_preview
            : (existing.member_preview || []),
          members: Array.isArray(conversation?.members) ? conversation.members : existing.members,
        },
      };
    });
  }, [upsertSearchConversation]);

  const mergeMessageIntoThread = useCallback((message) => {
    if (!message?.id) return;
    const optimisticMatch = messagesRef.current.find((item) => isLikelyOptimisticReplacement(item, message));
    if (optimisticMatch?.id) {
      upsertThreadMessage(
        withStableMessageRenderKey(message, optimisticMatch),
        { replaceId: optimisticMatch.id },
      );
      return;
    }
    upsertThreadMessage(withStableMessageRenderKey(message));
  }, [isLikelyOptimisticReplacement, upsertThreadMessage, withStableMessageRenderKey]);

  const applyOutgoingThreadMessage = useCallback((conversationId, message, {
    replaceId = '',
    previewOverrides = { unread_count: 0 },
    scroll = false,
    scrollSource = 'outgoingMessage',
    promote = true,
  } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId || !message?.id) return false;

    upsertThreadMessage(message, { replaceId });
    if (message?.is_own && !message?.isOptimistic) {
      setViewerLastReadMessageId(String(message.id || '').trim());
      setViewerLastReadAt(String(message.created_at || '').trim());
    }
    startTransition(() => {
      syncConversationPreview(normalizedConversationId, message, previewOverrides);
      if (promote) promoteConversationToTop(normalizedConversationId);
    });
    if (scroll) {
      queueAutoScroll('bottom_instant', scrollSource, { userInitiated: true });
    }
    return true;
  }, [promoteConversationToTop, queueAutoScroll, syncConversationPreview, upsertThreadMessage]);

  const applyMessageReadDelta = useCallback((payload) => {
    const messageId = String(payload?.message_id || '').trim();
    if (!messageId) return;
    setMessages((current) => applyReadReceiptDeltaToMessages(current, payload));
  }, []);

  const removeThreadMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;
    setMessages((current) => current.filter((item) => String(item?.id || '').trim() !== normalizedMessageId));
  }, []);

  const updatePresenceInCollections = useCallback((userId, presence) => {
    const normalizedUserId = Number(userId || 0);
    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !presence) return;
    const patchConversationPresence = (conversation) => {
      if (!conversation || typeof conversation !== 'object') return conversation;
      let changed = false;
      const nextConversation = { ...conversation };
      if (conversation?.kind === 'direct' && Number(conversation?.direct_peer?.id || 0) === normalizedUserId) {
        nextConversation.direct_peer = { ...conversation.direct_peer, presence };
        changed = true;
      }
      if (Array.isArray(conversation?.members)) {
        const nextMembers = conversation.members.map((member) => {
          if (Number(member?.user?.id || 0) !== normalizedUserId) return member;
          changed = true;
          return {
            ...member,
            user: {
              ...member.user,
              presence,
            },
          };
        });
        nextConversation.members = nextMembers;
      }
      if (Array.isArray(conversation?.member_preview)) {
        const nextMemberPreview = conversation.member_preview.map((member) => {
          if (Number(member?.user?.id || 0) !== normalizedUserId) return member;
          changed = true;
          return {
            ...member,
            user: {
              ...member.user,
              presence,
            },
          };
        });
        nextConversation.member_preview = nextMemberPreview;
      }
      return changed ? nextConversation : conversation;
    };

    setConversations((current) => current.map(patchConversationPresence));
    setConversationDetailsById((current) => Object.fromEntries(
      Object.entries(current).map(([conversationId, conversation]) => [
        conversationId,
        patchConversationPresence(conversation),
      ]),
    ));
    patchSearchConversations(patchConversationPresence);
    patchSearchPersonPresence(normalizedUserId, presence);
    patchGroupPresence(normalizedUserId, presence);
    setMessageReadsItems((current) => current.map((item) => (
      Number(item?.user?.id || 0) === normalizedUserId
        ? {
            ...item,
            user: {
              ...item.user,
              presence,
            },
          }
        : item
    )));
  }, [patchGroupPresence, patchSearchConversations, patchSearchPersonPresence]);

  const syncComposerSelection = useCallback(() => {
    const input = composerRef.current;
    composerSelectionRef.current = {
      start: Number.isInteger(input?.selectionStart) ? input.selectionStart : null,
      end: Number.isInteger(input?.selectionEnd) ? input.selectionEnd : null,
    };
  }, []);

  const insertEmojiAtSelection = useCallback((emoji) => {
    const input = composerRef.current;
    const currentValue = String(messageText || '');
    const storedStart = composerSelectionRef.current?.start;
    const storedEnd = composerSelectionRef.current?.end;
    const start = Number.isInteger(storedStart) ? storedStart : (Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length);
    const end = Number.isInteger(storedEnd) ? storedEnd : (Number.isInteger(input?.selectionEnd) ? input.selectionEnd : start);
    const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;
    const nextPosition = start + emoji.length;
    setMessageText(nextValue);
    composerSelectionRef.current = { start: nextPosition, end: nextPosition };
    if (isMobile) {
      // На мобильном не закрываем пикер — пользователь может набрать ещё эмодзи
      return;
    }
    setEmojiAnchorEl(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
      composerRef.current?.setSelectionRange?.(nextPosition, nextPosition);
    });
  }, [isMobile, messageText]);

  const markConversationReadLive = useCallback(async (conversationId, messageId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedConversationId || !normalizedMessageId) return null;
    let payload = null;
    if (CHAT_WS_ENABLED) {
      try {
        payload = await chatSocket.markRead(normalizedConversationId, normalizedMessageId);
      } catch {
        // Fallback to HTTP below.
      }
    }
    if (!payload) {
      payload = await chatAPI.markRead(normalizedConversationId, normalizedMessageId);
    }
    const resolvedMessageId = String(payload?.message_id || normalizedMessageId).trim();
    if (activeConversationIdRef.current === normalizedConversationId && resolvedMessageId) {
      setViewerLastReadMessageId((current) => resolveLatestMessageIdInOrder(messagesRef.current, current, resolvedMessageId));
      setViewerLastReadAt((current) => String(payload?.read_at || '').trim() || current);
      syncConversationUnreadState(normalizedConversationId, resolvedMessageId);
    }
    emitChatUnreadRefresh();
    return payload;
  }, [emitChatUnreadRefresh, syncConversationUnreadState]);
  markConversationReadLiveRef.current = markConversationReadLive;

  const loadHealth = useCallback(async () => {
    if (!CHAT_FEATURE_ENABLED) return;
    try {
      setHealth(await chatAPI.getHealth());
      setHealthError('');
    } catch (error) {
      setHealth(null);
      setHealthError(error?.response?.data?.detail || 'Не удалось проверить состояние chat backend.');
    }
  }, []);

  const loadConversations = useCallback(async ({ silent = false, force = false, revalidateOnCacheHit = false } = {}) => {
    if (!CHAT_FEATURE_ENABLED) return [];
    const requestSeq = conversationsRequestSeqRef.current + 1;
    conversationsRequestSeqRef.current = requestSeq;
    const cacheKeyParts = conversationsCacheKeyParts;
    if (!silent) {
      conversationsLoadingRequestSeqRef.current = requestSeq;
      setConversationsLoading(true);
    } else if (conversationsLoadingRef.current) {
      conversationsLoadingRequestSeqRef.current = requestSeq;
    }
    const sidebarScrollTop = silent ? sidebarScrollRef.current?.scrollTop ?? null : null;
    try {
      const cachedEntry = !silent && !force
        ? peekSWRCache(cacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== conversationsRequestSeqRef.current) return [];
        const cachedItems = applyConversationsPayload(cachedEntry.data, {
          preserveSidebarScrollTop: sidebarScrollTop,
        });
        if (requestSeq === conversationsLoadingRequestSeqRef.current) {
          conversationsLoadingRequestSeqRef.current = 0;
          setConversationsLoading(false);
        }
        if (revalidateOnCacheHit || !cachedEntry.isFresh) {
          void loadConversations({ silent: true, force: true }).catch(() => {});
        }
        return cachedItems;
      }

      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => chatAPI.getConversations({ q: '', limit: 100 }),
        {
          staleTimeMs: CHAT_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        },
      );
      if (requestSeq !== conversationsRequestSeqRef.current) return [];
      const items = applyConversationsPayload(result.data, {
        preserveSidebarScrollTop: sidebarScrollTop,
      });
      if (result.fromCache && (revalidateOnCacheHit || !result.isFresh) && !force) {
        void loadConversations({ silent: true, force: true }).catch(() => {});
      }
      return items;
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить список чатов.');
      return [];
    } finally {
      if (requestSeq === conversationsLoadingRequestSeqRef.current) {
        conversationsLoadingRequestSeqRef.current = 0;
        setConversationsLoading(false);
      }
    }
  }, [applyConversationsPayload, conversationsCacheKeyParts, notifyApiError]);
  loadConversationsRef.current = loadConversations;

  const applyFoldersPayload = useCallback((payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const idsByFolder = buildConversationIdsByFolder(items, payload?.conversation_ids_by_folder || {});
    setCustomFolders(items);
    setConversationIdsByFolder(idsByFolder);
    return items;
  }, []);

  const loadChatFolders = useCallback(async ({ silent = false } = {}) => {
    if (!CHAT_FEATURE_ENABLED) return [];
    if (!silent) setFoldersLoading(true);
    try {
      const payload = await chatFoldersAPI.listFolders();
      return applyFoldersPayload(payload);
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить папки чатов.');
      return [];
    } finally {
      if (!silent) setFoldersLoading(false);
    }
  }, [applyFoldersPayload, notifyApiError]);

  const handleActiveFolderChange = useCallback((nextFolderKey) => {
    const normalized = String(nextFolderKey || 'all').trim() || 'all';
    setConversationFilter(normalized);
    writeStoredActiveFolderKey(normalized);
  }, []);

  const handleOpenArchiveFolder = useCallback(() => {
    handleActiveFolderChange('archived');
  }, [handleActiveFolderChange]);

  const handleOpenFolderManager = useCallback((options = {}) => {
    setFolderManagerCreateMode(Boolean(options?.create));
    setFolderManagerOpen(true);
  }, []);

  const handleCreateChatFolder = useCallback(async (name) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.createFolder(name);
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать папку.');
      throw error;
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError]);

  const handleRenameChatFolder = useCallback(async (folderId, name) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.updateFolder(folderId, { name });
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переименовать папку.');
      throw error;
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError]);

  const handleDeleteChatFolder = useCallback(async (folderId) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.deleteFolder(folderId);
      if (String(conversationFilter) === String(folderId)) {
        handleActiveFolderChange('all');
      }
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить папку.');
    } finally {
      setFolderSaving(false);
    }
  }, [conversationFilter, handleActiveFolderChange, loadChatFolders, notifyApiError]);

  const handleReorderChatFolder = useCallback(async (folderId, direction) => {
    const items = [...customFolders];
    const index = items.findIndex((item) => String(item?.id || '') === String(folderId));
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setFolderSaving(true);
    try {
      await Promise.all(next.map((folder, sortOrder) => (
        chatFoldersAPI.updateFolder(folder.id, { sort_order: sortOrder })
      )));
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить порядок папок.');
    } finally {
      setFolderSaving(false);
    }
  }, [customFolders, loadChatFolders, notifyApiError]);

  const handleRemoveConversationFromFolder = useCallback(async (folderId, conversationId) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.removeFolderConversation(folderId, conversationId);
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось убрать чат из папки.');
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError]);

  const handleToggleConversationInFolder = useCallback(async (folderId, conversationId, nextIncluded) => {
    const normalizedFolderId = String(folderId || '').trim();
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedFolderId || !normalizedConversationId) return;
    try {
      if (nextIncluded) {
        await chatFoldersAPI.addFolderConversation(normalizedFolderId, normalizedConversationId);
      } else {
        await chatFoldersAPI.removeFolderConversation(normalizedFolderId, normalizedConversationId);
      }
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить папку чата.');
    }
  }, [loadChatFolders, notifyApiError]);

  const abortActiveThreadLoad = useCallback(() => {
    const controller = threadLoadAbortRef.current;
    if (!controller) return;
    try {
      controller.abort();
    } catch {
      // Ignore stale abort failures.
    }
    threadLoadAbortRef.current = null;
  }, []);

  const prefetchThreadBootstrap = useCallback(async (conversationId, { force = false } = {}) => {
    const id = String(conversationId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) return null;
    const cacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
    if (!force) {
      const cachedEntry = peekSWRCache(cacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS });
      if (cachedEntry?.data) return cachedEntry.data;
    }

    const existingController = threadPrefetchAbortControllersRef.current.get(id);
    if (existingController) return null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) {
      threadPrefetchAbortControllersRef.current.set(id, controller);
    }

    try {
      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => (typeof chatAPI.getThreadBootstrap === 'function'
          ? chatAPI.getThreadBootstrap(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )
          : chatAPI.getMessages(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )),
        {
          staleTimeMs: CHAT_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        },
      );
      return result?.data || null;
    } catch {
      return null;
    } finally {
      if (controller) {
        threadPrefetchAbortControllersRef.current.delete(id);
      }
    }
  }, [userCacheId]);

  const loadThreadBootstrap = useCallback(async (conversationId, {
    silent = false,
    reason = 'thread-bootstrap',
    force = false,
  } = {}) => {
    const id = String(conversationId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) {
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      return [];
    }

    abortActiveThreadLoad();
    if (!silent) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
      setMessagesLoading(true);
    } else if (messagesLoadingRef.current) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
    }

    const requestSeq = messagesRequestSeqRef.current + 1;
    messagesRequestSeqRef.current = requestSeq;
    logChatDebug('loadThreadBootstrap:start', {
      conversationId: id,
      reason,
      requestSeq,
      silent,
      force,
    });

    try {
      const cacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
      const cachedEntry = !silent && !force
        ? peekSWRCache(cacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
          return [];
        }
        const cachedItems = applyLatestThreadPayload(id, cachedEntry.data);
        resolvePendingInitialAnchorFromPayload(id, cachedEntry.data);
        if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadThreadBootstrap(id, {
            silent: true,
            reason: `${reason}:revalidate`,
            force: true,
          }).catch(() => {});
        }
        return cachedItems;
      }

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      threadLoadAbortRef.current = controller;
      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => (typeof chatAPI.getThreadBootstrap === 'function'
          ? chatAPI.getThreadBootstrap(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )
          : chatAPI.getMessages(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )),
        {
          staleTimeMs: CHAT_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        },
      );
      if (controller && threadLoadAbortRef.current === controller) {
        threadLoadAbortRef.current = null;
      }
      if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
        return [];
      }

      const data = result?.data || {};
      resolvePendingInitialAnchorFromPayload(id, data);

      applyLatestThreadPayload(id, data);
      return Array.isArray(data?.items) ? data.items : [];
    } catch (error) {
      if (String(error?.code || '') !== 'ERR_CANCELED' && String(error?.name || '') !== 'CanceledError') {
        logChatDebug('loadThreadBootstrap:error', {
          conversationId: id,
          reason,
          requestSeq,
          error: String(error?.message || error),
        });
        if (!silent) notifyApiError(error, 'Не удалось открыть чат.');
      }
      return [];
    } finally {
      if (requestSeq === messagesLoadingRequestSeqRef.current) {
        messagesLoadingRequestSeqRef.current = 0;
        setMessagesLoading(false);
      }
    }
  }, [abortActiveThreadLoad, applyLatestThreadPayload, logChatDebug, notifyApiError, resolvePendingInitialAnchorFromPayload, userCacheId]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || sidebarSearchActive || conversationsLoading) return undefined;
    const prefetchQueue = buildThreadPrefetchQueue(conversations, activeConversationId, {
      limit: isMobile ? 4 : 8,
    });
    if (prefetchQueue.length === 0) return undefined;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      const prefetchSequentially = async () => {
        for (const conversationId of prefetchQueue) {
          if (cancelled) return;
          await prefetchThreadBootstrap(conversationId);
          if (cancelled) return;
          await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
      };
      void prefetchSequentially();
    }, isMobile ? 220 : 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeConversationId, conversations, conversationsLoading, isMobile, prefetchThreadBootstrap, sidebarSearchActive]);

  const loadMessages = useCallback(async (conversationId, {
    silent = false,
    beforeMessageId = '',
    afterMessageId = '',
    reason = 'unspecified',
    force = false,
  } = {}) => {
    const id = String(conversationId || '').trim();
    const beforeId = String(beforeMessageId || '').trim();
    const afterId = String(afterMessageId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) {
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      return [];
    }

    if (!beforeId && !afterId) {
      return loadThreadBootstrap(id, { silent, reason, force });
    }

    const loadingOlderRequest = Boolean(beforeId);
    const loadingNewerRequest = Boolean(afterId);
    if (loadingOlderRequest) {
      setLoadingOlder(true);
      prependScrollRestoreRef.current = capturePrependScrollRestore();
    } else if (!silent) {
      messagesLoadingRequestSeqRef.current = messagesRequestSeqRef.current + 1;
      setMessagesLoading(true);
    }

    const requestSeq = loadingOlderRequest
      ? messagesRequestSeqRef.current
      : messagesRequestSeqRef.current + 1;
    if (!loadingOlderRequest) {
      messagesRequestSeqRef.current = requestSeq;
    }
    logChatDebug('loadMessages:start', {
      conversationId: id,
      reason,
      requestSeq,
      silent,
      beforeMessageId: beforeId || null,
      afterMessageId: afterId || null,
      loadingOlderRequest,
      loadingNewerRequest,
    });
    if (!loadingOlderRequest && silent && messagesLoadingRef.current) {
      messagesLoadingRequestSeqRef.current = requestSeq;
    }
    const previousLastMessage = !loadingOlderRequest && !loadingNewerRequest && activeConversationIdRef.current === id
      ? messagesRef.current[messagesRef.current.length - 1]
      : null;
    const previousConversation = conversationsRef.current.find((item) => item.id === id) || null;
    const shouldStickToBottom = threadNearBottomRef.current;
    const initialAnchorPending = hasPendingInitialAnchorForConversation(id);

    try {
      const latestThreadCacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
      const cachedEntry = !loadingOlderRequest && !loadingNewerRequest && !silent && !force
        ? peekSWRCache(latestThreadCacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== messagesRequestSeqRef.current || activeConversationIdRef.current !== id) {
          return [];
        }
        const cachedItems = applyLatestThreadPayload(id, cachedEntry.data);
        resolvePendingInitialAnchorFromPayload(id, cachedEntry.data);
        if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadMessages(id, {
            silent: true,
            reason: `${reason}:revalidate`,
            force: true,
          }).catch(() => {});
        }
        return cachedItems;
      }

      const data = loadingOlderRequest || loadingNewerRequest
        ? await chatAPI.getMessages(id, {
            limit: 50,
            before_message_id: beforeId || undefined,
            after_message_id: afterId || undefined,
          })
        : (await getOrFetchSWR(
            latestThreadCacheKeyParts,
            () => chatAPI.getMessages(id, {
              limit: 100,
            }),
            {
              staleTimeMs: CHAT_SWR_STALE_TIME_MS,
              force,
              revalidateStale: false,
            },
          )).data;
      if (activeConversationIdRef.current !== id) {
        logChatDebug('loadMessages:stale', {
          conversationId: id,
          reason,
          requestSeq,
          latestRequestSeq: messagesRequestSeqRef.current,
          activeConversationId: activeConversationIdRef.current,
          loadingOlderRequest,
        });
        if (loadingOlderRequest) {
          prependScrollRestoreRef.current = null;
        }
        return [];
      }
      if (!loadingOlderRequest && requestSeq !== messagesRequestSeqRef.current) {
        logChatDebug('loadMessages:stale', {
          conversationId: id,
          reason,
          requestSeq,
          latestRequestSeq: messagesRequestSeqRef.current,
          activeConversationId: activeConversationIdRef.current,
          loadingOlderRequest,
        });
        return [];
      }

      const cursorInvalid = Boolean(data?.cursor_invalid);
      if (cursorInvalid) {
        logChatDebug('loadMessages:cursor_invalid', {
          conversationId: id,
          reason,
          requestSeq,
          beforeMessageId: beforeId || null,
          afterMessageId: afterId || null,
          loadingOlderRequest,
          loadingNewerRequest,
        });
        if (loadingOlderRequest) {
          if (requestSeq === messagesRequestSeqRef.current && activeConversationIdRef.current === id) {
            setLoadingOlder(false);
          }
        } else if (requestSeq === messagesLoadingRequestSeqRef.current) {
          messagesLoadingRequestSeqRef.current = 0;
          setMessagesLoading(false);
        }
        if (activeConversationIdRef.current === id) {
          const reloadOptions = buildCursorInvalidThreadReloadOptions(reason);
          void loadThreadBootstrap(id, reloadOptions).catch(() => {});
        }
        return [];
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const hasOlder = Boolean(data?.has_older ?? data?.has_more);
      const hasNewer = Boolean(data?.has_newer);

      if (loadingOlderRequest) {
        const seen = new Set(messagesRef.current.map((item) => item.id));
        const older = items.filter((item) => !seen.has(item.id));
        const appendedCount = older.length;
        // #region agent log
        emitAgentDebugLog({
          location: 'Chat.jsx:loadMessages:prependOlder',
          message: 'load older prepend evaluated',
          hypothesisId: 'H-HISTORY-WIPE',
          data: {
            conversationId: id,
            reason,
            apiItemsCount: items.length,
            appendedCount,
            hasOlder,
            beforeMessageId: beforeId || null,
          },
        });
        // #endregion
        if (appendedCount === 0) {
          prependScrollRestoreRef.current = null;
          setMessagesHasMore(false);
        } else {
          setMessagesHasMore(hasOlder);
          setMessagesHasNewer((current) => current || hasNewer);
          setMessages((current) => [...older, ...current]);
        }
        return items;
      }

      if (loadingNewerRequest) {
        setMessagesHasMore((current) => current || hasOlder);
        setMessagesHasNewer(hasNewer);
        setMessages((current) => {
          const seen = new Set(current.map((item) => item.id));
          const newer = items.filter((item) => !seen.has(item.id));
          if (newer.length === 0) return current;
          return [...current, ...newer];
        });
        return items;
      }

      const last = items[items.length - 1];
      const previousLastId = String(previousLastMessage?.id || '').trim();
      const nextLastId = String(last?.id || '').trim();
      const previousHadConversationMessage = Boolean(previousConversation?.last_message_at || previousConversation?.last_message_preview);
      const lastMessageChanged = Boolean(nextLastId) && Boolean(previousLastId) && previousLastId !== nextLastId;
      const firstConversationMessageArrived = Boolean(nextLastId) && !previousLastId && !previousHadConversationMessage;
      const nextViewerLastReadMessageId = String(data?.viewer_last_read_message_id || '').trim();
      if (!loadingOlderRequest && !loadingNewerRequest) {
        resolvePendingInitialAnchorFromPayload(id, {
          items,
          viewer_last_read_message_id: nextViewerLastReadMessageId,
          viewer_last_read_at: String(data?.viewer_last_read_at || '').trim(),
        });
      }

      applyLatestThreadPayload(id, {
        items,
        has_more: hasOlder,
        has_older: hasOlder,
        has_newer: hasNewer,
        viewer_last_read_message_id: nextViewerLastReadMessageId,
        viewer_last_read_at: String(data?.viewer_last_read_at || '').trim(),
      });

      if ((lastMessageChanged || firstConversationMessageArrived) && shouldStickToBottom && !initialAnchorPending) {
        queueAutoScroll('bottom_instant', 'loadMessages:latest_payload');
      }

      logChatDebug('loadMessages:success', {
        conversationId: id,
        reason,
        requestSeq,
        itemsCount: items.length,
        hasOlder,
        hasNewer,
        lastMessageId: String(last?.id || '').trim(),
        viewerLastReadMessageId: nextViewerLastReadMessageId,
        shouldStickToBottom,
        initialAnchorPending,
      });

      if (last?.id) {
        syncConversationPreview(id, last);
      }

      return items;
    } catch (error) {
      logChatDebug('loadMessages:error', {
        conversationId: id,
        reason,
        requestSeq,
        error: String(error?.message || error),
      });
      const notifyLoadError = shouldNotifyLoadMessagesError({
        silent,
        reason,
        error,
        loadingOlderRequest,
        loadingNewerRequest,
      });
      // #region agent log
      emitAgentDebugLog({
        location: 'Chat.jsx:loadMessages',
        message: notifyLoadError ? 'loadMessages error toast shown' : 'loadMessages error suppressed',
        hypothesisId: 'H-502',
        data: {
          reason,
          silent,
          loadingOlderRequest,
          loadingNewerRequest,
          status: Number(error?.response?.status || 0),
          notifyLoadError,
        },
      });
      // #endregion
      if (notifyLoadError) {
        notifyApiError(error, loadingOlderRequest ? 'Не удалось загрузить более ранние сообщения.' : 'Не удалось загрузить сообщения чата.');
      }
      return [];
    } finally {
      if (loadingOlderRequest) {
        if (activeConversationIdRef.current === id) setLoadingOlder(false);
      } else if (requestSeq === messagesLoadingRequestSeqRef.current) {
        messagesLoadingRequestSeqRef.current = 0;
        setMessagesLoading(false);
      }
    }
  }, [applyLatestThreadPayload, capturePrependScrollRestore, hasPendingInitialAnchorForConversation, loadThreadBootstrap, logChatDebug, notifyApiError, queueAutoScroll, resolvePendingInitialAnchorFromPayload, syncConversationPreview, userCacheId]);
  loadMessagesRef.current = loadMessages;

  useEffect(() => () => {
    abortActiveThreadLoad();
  }, [abortActiveThreadLoad]);

  const handleOptimisticRead = useCallback((readMessageId) => {
    const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
    const normalizedReadMessageId = String(readMessageId || '').trim();
    if (!normalizedConversationId || !normalizedReadMessageId) return;
    syncConversationUnreadState(normalizedConversationId, normalizedReadMessageId);
  }, [syncConversationUnreadState]);

  const handleReadReceiptsSyncError = useCallback(() => {
    if (activeConversationIdRef.current) {
      void loadMessages(activeConversationIdRef.current, {
        silent: true,
        reason: 'read-receipts:revalidate',
        force: true,
      }).catch(() => {});
    }
    if (!sidebarSearchActive) {
      void loadConversations({ silent: true, force: true }).catch(() => {});
    }
  }, [loadConversations, loadMessages, sidebarSearchActive]);

  const {
    effectiveLastReadMessageId,
    getReadTargetRef,
  } = useReadReceipts({
    conversationId: activeConversationId,
    messages,
    enabled: Boolean(activeConversationId && !messagesLoading),
    scrollRootRef: threadScrollRef,
    viewerLastReadMessageId,
    markRead: markConversationReadLive,
    onOptimisticRead: handleOptimisticRead,
    onReadSyncError: handleReadReceiptsSyncError,
  });

  const revealMessage = useCallback(async (messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId || !activeConversationIdRef.current) return false;
    if (scrollToMessage(normalizedMessageId)) return true;

    let iterations = 0;
    while (messagesHasMoreRef.current && iterations < 12) {
      const oldestMessageId = String(messagesRef.current[0]?.id || '').trim();
      if (!oldestMessageId) break;
      const olderItems = await loadMessages(activeConversationIdRef.current, {
        silent: true,
        beforeMessageId: oldestMessageId,
        reason: 'reveal:load_older',
      });
      iterations += 1;
      if (!Array.isArray(olderItems) || olderItems.length === 0) break;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (scrollToMessage(normalizedMessageId)) return true;
    }
    return false;
  }, [loadMessages, scrollToMessage]);
  revealMessageRef.current = revealMessage;

  useEffect(() => {
    if (!requestedMessageId) {
      requestedMessageRevealKeyRef.current = '';
      return;
    }
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!normalizedConversationId || normalizedConversationId !== requestedConversationId) return;
    if (messagesLoading) return;
    const revealKey = `${normalizedConversationId}:${requestedMessageId}`;
    if (requestedMessageRevealKeyRef.current === revealKey) return;

    let cancelled = false;
    void revealMessage(requestedMessageId).then((found) => {
      if (cancelled || !found) return;
      requestedMessageRevealKeyRef.current = revealKey;
      const nextParams = new URLSearchParams(location.search);
      if (String(nextParams.get('message') || '').trim() !== requestedMessageId) return;
      nextParams.delete('message');
      const nextSearch = nextParams.toString();
      navigate({ pathname: '/chat', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId, location.search, messages.length, messagesLoading, navigate, requestedConversationId, requestedMessageId, revealMessage]);

  const handleOpenPinnedMessage = useCallback(async () => {
    const normalizedMessageId = String(pinnedMessage?.id || '').trim();
    if (!normalizedMessageId) return;
    const found = await revealMessage(normalizedMessageId);
    if (!found) {
      notifyInfo(
        '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0439\u0442\u0438 \u0437\u0430\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0432 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043d\u043e\u0439 \u0438\u0441\u0442\u043e\u0440\u0438\u0438.',
        { title: '\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e' },
      );
    }
  }, [notifyInfo, pinnedMessage?.id, revealMessage]);

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
  }, [activeConversationId, notifyApiError, upsertSearchConversation]);

  const applyGroupConversationUpdate = useCallback((updated) => {
    const normalizedConversationId = String(updated?.id || '').trim();
    if (!normalizedConversationId) return updated;
    setConversations((current) => {
      const exists = current.some((item) => String(item?.id || '').trim() === normalizedConversationId);
      const next = exists
        ? current.map((item) => (String(item?.id || '').trim() === normalizedConversationId ? { ...item, ...updated } : item))
        : [{ ...updated }, ...current];
      return next;
    });
    upsertConversationDetail(updated);
    upsertSearchConversation(updated);
    return updated;
  }, [upsertConversationDetail, upsertSearchConversation]);

  const handleAddGroupMembers = useCallback(async (memberUserIds) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.addGroupMembers(conversationId, memberUserIds);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось добавить участников.');
      throw error;
    }
  }, [applyGroupConversationUpdate, notifyApiError]);

  const handleRemoveGroupMember = useCallback(async (memberUserId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.removeGroupMember(conversationId, memberUserId);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось исключить участника.');
      throw error;
    }
  }, [applyGroupConversationUpdate, notifyApiError]);

  const handleUpdateGroupMemberRole = useCallback(async (memberUserId, memberRole) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.updateGroupMemberRole(conversationId, memberUserId, memberRole);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить роль участника.');
      throw error;
    }
  }, [applyGroupConversationUpdate, notifyApiError]);

  const handleTransferGroupOwnership = useCallback(async (ownerUserId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.transferGroupOwnership(conversationId, ownerUserId);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось передать владельца группы.');
      throw error;
    }
  }, [applyGroupConversationUpdate, notifyApiError]);

  const handleUpdateGroupProfile = useCallback(async (payload) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.updateGroupProfile(conversationId, payload);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить группу.');
      throw error;
    }
  }, [applyGroupConversationUpdate, notifyApiError]);

  const handleLeaveGroup = useCallback(async () => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const payload = await chatAPI.leaveGroup(conversationId);
      setConversations((current) => current.filter((item) => String(item?.id || '').trim() !== conversationId));
      setConversationDetailsById((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      clearStoredConversationState({ conversationId, invalidateThread: true });
      setInfoOpen(false);
      setContextPanelOpen(false);
      setActiveConversationId('');
      if (isMobile) openMobileInboxView();
      return payload;
    } catch (error) {
      notifyApiError(error, 'Не удалось выйти из группы.');
      throw error;
    }
  }, [clearStoredConversationState, isMobile, notifyApiError, openMobileInboxView]);

  const handleRemoteConversationRemoved = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    setConversations((current) => current.filter((item) => String(item?.id || '').trim() !== normalizedConversationId));
    setConversationDetailsById((current) => {
      const next = { ...current };
      delete next[normalizedConversationId];
      return next;
    });
    if (String(activeConversationIdRef.current || '').trim() === normalizedConversationId) {
      clearStoredConversationState({ conversationId: normalizedConversationId, invalidateThread: true });
      setInfoOpen(false);
      setContextPanelOpen(false);
      setActiveConversationId('');
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      if (isMobile) openMobileInboxView();
    }
  }, [clearStoredConversationState, isMobile, openMobileInboxView]);

  const applyAiBotsPayload = useCallback((payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    aiBotsCacheHydratedRef.current = true;
    setAiBots(items);
    setAiBotsError('');
    return items;
  }, []);

  const loadAiBots = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!canUseAiChat) {
      setAiBots([]);
      setAiBotsError('');
      setAiBotsLoading(false);
      return [];
    }

    const requestSeq = aiBotsRequestSeqRef.current + 1;
    aiBotsRequestSeqRef.current = requestSeq;
    if (!silent) {
      aiBotsLoadingRequestSeqRef.current = requestSeq;
      setAiBotsLoading(true);
    } else if (aiBotsLoadingRef.current) {
      aiBotsLoadingRequestSeqRef.current = requestSeq;
    }
    setAiBotsError('');

    try {
      const cachedEntry = !silent && !force
        ? peekSWRCache(aiBotsCacheKeyParts, { staleTimeMs: CHAT_SWR_STALE_TIME_MS })
        : null;

      if (cachedEntry?.data) {
        if (requestSeq !== aiBotsRequestSeqRef.current) return [];
        const items = applyAiBotsPayload(cachedEntry.data);
        if (requestSeq === aiBotsLoadingRequestSeqRef.current) {
          aiBotsLoadingRequestSeqRef.current = 0;
          setAiBotsLoading(false);
        }
        if (!cachedEntry.isFresh) {
          void loadAiBots({ silent: true, force: true }).catch(() => {});
        }
        return items;
      }

      const result = await getOrFetchSWR(
        aiBotsCacheKeyParts,
        () => chatAPI.listAiBots(),
        {
          staleTimeMs: CHAT_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        },
      );
      if (requestSeq !== aiBotsRequestSeqRef.current) return [];
      const items = applyAiBotsPayload(result.data);
      if (result.fromCache && !result.isFresh && !force) {
        void loadAiBots({ silent: true, force: true }).catch(() => {});
      }
      return items;
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить AI-ботов.');
      setAiBots([]);
      setAiBotsError('Failed to load AI bots.');
      return [];
    } finally {
      if (requestSeq === aiBotsLoadingRequestSeqRef.current) {
        aiBotsLoadingRequestSeqRef.current = 0;
        setAiBotsLoading(false);
      }
    }
  }, [aiBotsCacheKeyParts, applyAiBotsPayload, canUseAiChat, notifyApiError]);

  useEffect(() => {
    void loadConversations();
    void loadChatFolders();
  }, [loadChatFolders, loadConversations]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || notesEnsuredRef.current || conversationsLoading) return;
    notesEnsuredRef.current = true;
    void chatAPI.ensureNotesConversation()
      .then((notes) => {
        const normalizedConversationId = String(notes?.id || '').trim();
        if (!normalizedConversationId) return;
        setConversations((current) => {
          const exists = current.some((item) => String(item?.id || '').trim() === normalizedConversationId);
          const next = exists
            ? current.map((item) => (
              String(item?.id || '').trim() === normalizedConversationId ? { ...item, ...notes } : item
            ))
            : [{ ...notes }, ...current];
          return sortSidebarConversations(next);
        });
        upsertSearchConversation(notes);
      })
      .catch(() => {
        notesEnsuredRef.current = false;
      });
  }, [conversationsLoading, upsertSearchConversation]);

  useEffect(() => {
    void loadAiBots();
  }, [loadAiBots]);

  useEffect(() => {
    const conversationId = String(activeConversationId || '').trim();
    if (!shouldRequestConversationAiStatus({
      conversationId,
      conversationKind: activeConversation?.kind,
      canUseAiChat,
    })) return;
    let cancelled = false;
    void chatAPI.getConversationAiStatus(conversationId)
      .then((status) => {
        if (cancelled || !status?.conversation_id) return;
        setAiStatusByConversation((current) => mergeAiStatusPayload(current, status));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.kind, activeConversationId, canUseAiChat]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const prefetchHeavyChatSurfaces = () => {
      void loadChatDialogsModule();
      if (!isMobile && renderDesktopContextPanel) {
        void loadChatContextPanelModule();
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(prefetchHeavyChatSurfaces, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(prefetchHeavyChatSurfaces, 900);
    return () => window.clearTimeout(timeoutId);
  }, [isMobile, renderDesktopContextPanel]);

  useEffect(() => {
    logChatDebug('chat:init', {
      chatFeatureEnabled: CHAT_FEATURE_ENABLED,
      chatWsEnabled: CHAT_WS_ENABLED,
      threadPollMs: THREAD_POLL_MS,
    });
  }, [logChatDebug]);

  useLayoutEffect(() => {
    const layoutKey = `${userCacheId}:${String(activeConversationId || '').trim()}`;
    if (lastHandledThreadLayoutKeyRef.current === layoutKey) return;
    lastHandledThreadLayoutKeyRef.current = layoutKey;

    if (!activeConversationId) {
      logChatDebugRef.current?.('effect:activeConversation:clear');
      cancelPendingInitialAnchorRef.current?.();
      clearInitialViewportGuard('conversation_cleared');
      clearMobileKeyboardSettleTimeouts();
      hydratedThreadConversationIdRef.current = '';
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      messagesLoadingRequestSeqRef.current = 0;
      setMessagesLoading(false);
      setReplyMessage(null);
      setEditingMessage(null);
      return;
    }
    logChatDebugRef.current?.('effect:activeConversation:load', {
      conversationId: activeConversationId,
    });
    queueInitialThreadPositionRef.current?.(activeConversationId);
    clearMobileKeyboardSettleTimeouts();
    focusComposerRef.current?.();

    const isFromNotification = String(requestedConversationId || '').trim() === activeConversationId;

    if (isFromNotification) {
      invalidateSWRCacheByPrefix('chat', 'thread', userCacheId, activeConversationId);
    }

    const cachedThreadEntry = !isFromNotification
      ? peekSWRCache(
        buildChatThreadCacheKeyParts(userCacheId, activeConversationId),
        { staleTimeMs: CHAT_SWR_STALE_TIME_MS },
      )
      : null;

    const applyActiveConversationThreadLoad = () => {
      if (cachedThreadEntry?.data) {
        applyLatestThreadPayload(activeConversationId, cachedThreadEntry.data);
        resolvePendingInitialAnchorFromPayload(activeConversationId, cachedThreadEntry.data);
        setMessagesLoading(false);
        void loadThreadBootstrap(activeConversationId, {
          silent: true,
          reason: 'effect:activeConversation:revalidate',
          force: true,
        });
      } else {
        hydratedThreadConversationIdRef.current = '';
        setMessages([]);
        setMessagesHasMore(false);
        setMessagesHasNewer(false);
        setViewerLastReadMessageId('');
        setViewerLastReadAt('');
        void loadThreadBootstrap(activeConversationId, {
          reason: isFromNotification ? 'effect:activeConversation:fromNotification' : 'effect:activeConversation',
          force: isFromNotification,
        });
      }
      setReplyMessage(null);
      setEditingMessage(null);
      resetMessageSearch();
    };

    if (isMobile && !mobileMotionDisabled) {
      const timeoutId = window.setTimeout(
        applyActiveConversationThreadLoad,
        CHAT_MOBILE_SCREEN_TRANSITION_MS,
      );
      return () => window.clearTimeout(timeoutId);
    }
    applyActiveConversationThreadLoad();
    return undefined;
  }, [activeConversationId, applyLatestThreadPayload, clearInitialViewportGuard, clearMobileKeyboardSettleTimeouts, isMobile, loadThreadBootstrap, mobileMotionDisabled, requestedConversationId, resetMessageSearch, resolvePendingInitialAnchorFromPayload, userCacheId]);

  useEffect(() => {
    suppressDraftSyncRef.current = true;
    setReplyMessage(null);
    setEditingMessage(null);
    if (!draftStorageKey) {
      setMessageText('');
      const timeoutId = window.setTimeout(() => {
        suppressDraftSyncRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    const pendingShareDraft = shareComposeDraftRef.current;
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (
      pendingShareDraft
      && String(pendingShareDraft.conversationId || '').trim() === normalizedConversationId
    ) {
      shareComposeDraftRef.current = null;
      const bodyText = String(pendingShareDraft.bodyText || '');
      setMessageText(bodyText);
      latestMessageTextRef.current = bodyText;
      try {
        window.localStorage.setItem(draftStorageKey, bodyText);
      } catch {
        // Ignore browser storage failures for drafts.
      }
      const timeoutId = window.setTimeout(() => {
        suppressDraftSyncRef.current = false;
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    try {
      setMessageText(window.localStorage.getItem(draftStorageKey) || '');
    } catch {
      setMessageText('');
    }
    const timeoutId = window.setTimeout(() => {
      suppressDraftSyncRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeConversationId, draftStorageKey]);

  useEffect(() => {
    latestMessageTextRef.current = messageText;
  }, [messageText]);

  useEffect(() => {
    const previousDraftKey = latestDraftStorageKeyRef.current;
    if (previousDraftKey && previousDraftKey !== draftStorageKey) {
      if (draftWriteTimeoutRef.current) {
        window.clearTimeout(draftWriteTimeoutRef.current);
        draftWriteTimeoutRef.current = null;
      }
      flushDraftToStorage(previousDraftKey, latestMessageTextRef.current);
    }
    latestDraftStorageKeyRef.current = draftStorageKey;
  }, [draftStorageKey, flushDraftToStorage]);

  useEffect(() => {
    if (!draftStorageKey || suppressDraftSyncRef.current) return undefined;
    if (draftWriteTimeoutRef.current) {
      window.clearTimeout(draftWriteTimeoutRef.current);
    }
    const timeoutId = window.setTimeout(() => {
      draftWriteTimeoutRef.current = null;
      flushDraftToStorage(draftStorageKey, messageText);
    }, 320);
    draftWriteTimeoutRef.current = timeoutId;
    return () => {
      window.clearTimeout(timeoutId);
      if (draftWriteTimeoutRef.current === timeoutId) {
        draftWriteTimeoutRef.current = null;
      }
    };
  }, [draftStorageKey, flushDraftToStorage, messageText]);

  useEffect(() => {
    const flushPendingDraft = () => {
      if (draftWriteTimeoutRef.current) {
        window.clearTimeout(draftWriteTimeoutRef.current);
        draftWriteTimeoutRef.current = null;
      }
      flushDraftToStorage(latestDraftStorageKeyRef.current, latestMessageTextRef.current);
    };

    window.addEventListener('pagehide', flushPendingDraft);
    return () => {
      window.removeEventListener('pagehide', flushPendingDraft);
      flushPendingDraft();
    };
  }, [flushDraftToStorage]);

  useEffect(() => {
    if (!pinnedMessageStorageKey) {
      setPinnedMessage(null);
      return;
    }
    const storedPinnedMessage = readLocalStorageJsonObject(pinnedMessageStorageKey);
    const normalizedMessageId = String(storedPinnedMessage?.id || '').trim();
    if (!normalizedMessageId) {
      setPinnedMessage(null);
      return;
    }
    setPinnedMessage({
      id: normalizedMessageId,
      senderName: String(storedPinnedMessage?.senderName || '').trim(),
      preview: String(storedPinnedMessage?.preview || '').trim(),
      createdAt: String(storedPinnedMessage?.createdAt || '').trim(),
    });
  }, [pinnedMessageStorageKey]);

  useEffect(() => {
    const pinnedMessageId = String(pinnedMessage?.id || '').trim();
    if (!pinnedMessageId) return;
    const latestPinnedMessage = messages.find((item) => String(item?.id || '').trim() === pinnedMessageId);
    if (!latestPinnedMessage) return;
    const nextPinnedMessage = buildPinnedMessagePayload(latestPinnedMessage);
    if (!nextPinnedMessage) return;
    if (
      nextPinnedMessage.senderName === String(pinnedMessage?.senderName || '').trim()
      && nextPinnedMessage.preview === String(pinnedMessage?.preview || '').trim()
      && nextPinnedMessage.createdAt === String(pinnedMessage?.createdAt || '').trim()
    ) {
      return;
    }
    persistPinnedMessage(nextPinnedMessage);
  }, [buildPinnedMessagePayload, messages, persistPinnedMessage, pinnedMessage]);

  useEffect(() => {
    if (conversationsLoading) return;
    const requestedExists = requestedConversationId && conversations.some((item) => item.id === requestedConversationId);
    const restoredExists = restoredConversationId && conversations.some((item) => item.id === restoredConversationId);

    if (!conversationBootstrapComplete) {
      if (composePrefillRequested) {
        cancelPendingInitialAnchor();
        setActiveConversationId('');
        if (isMobile) setMobileView('inbox');
        setConversationBootstrapComplete(true);
        return;
      }
      if (requestedConversationId) {
        if (requestedExists) {
          requestedConversationHandledRef.current = requestedConversationId;
          requestedConversationRetryRef.current = '';
          invalidConversationRef.current = '';
          applyingRequestedConversationRef.current = requestedConversationId;
          setActiveConversationId(requestedConversationId);
          if (isMobile) {
            setMobileView('thread');
            if (mobileHistoryReadyRef.current) {
              writeMobileHistoryState({ view: 'thread', drawerOpen: false, infoOpen: false }, 'replace', requestedConversationId);
            }
          }
          setConversationBootstrapComplete(true);
          return;
        }
        if (requestedConversationRetryRef.current !== requestedConversationId) {
          requestedConversationRetryRef.current = requestedConversationId;
          void loadConversations({ silent: true, force: true }).catch(() => {});
          return;
        }
        requestedConversationHandledRef.current = requestedConversationId;
        applyingRequestedConversationRef.current = '';
        if (invalidConversationRef.current !== requestedConversationId) {
          invalidConversationRef.current = requestedConversationId;
          notifyInfo?.('Чат из ссылки недоступен или вы больше не являетесь его участником.', { title: 'Чат недоступен' });
        }
        clearStoredConversationState({ conversationId: requestedConversationId, invalidateThread: true });
        cancelPendingInitialAnchor();
        setActiveConversationId('');
        if (isMobile) setMobileView('inbox');
        setConversationBootstrapComplete(true);
        navigate('/chat', { replace: true });
        return;
      }

      if (restoredConversationId) {
        if (restoredExists) {
          invalidConversationRef.current = '';
          applyingRequestedConversationRef.current = '';
          setActiveConversationId(restoredConversationId);
          if (isMobile) setMobileView(restoredMobileView === 'thread' ? 'thread' : 'inbox');
          setConversationBootstrapComplete(true);
          return;
        }
        clearStoredConversationState({ conversationId: restoredConversationId, invalidateThread: true });
      }

      cancelPendingInitialAnchor();
      setActiveConversationId('');
      if (isMobile) setMobileView('inbox');
      setConversationBootstrapComplete(true);
      return;
    }

    if (requestedConversationId && requestedConversationId !== requestedConversationHandledRef.current) {
      if (requestedExists) {
        requestedConversationHandledRef.current = requestedConversationId;
        requestedConversationRetryRef.current = '';
        invalidConversationRef.current = '';
        applyingRequestedConversationRef.current = requestedConversationId;
        setActiveConversationId(requestedConversationId);
        if (isMobile) {
          setMobileView('thread');
          if (mobileHistoryReadyRef.current) {
            writeMobileHistoryState({ view: 'thread', drawerOpen: false, infoOpen: false }, 'replace', requestedConversationId);
          }
        }
        return;
      }
      if (requestedConversationRetryRef.current !== requestedConversationId) {
        requestedConversationRetryRef.current = requestedConversationId;
        void loadConversations({ silent: true, force: true }).catch(() => {});
        return;
      }
      requestedConversationHandledRef.current = requestedConversationId;
      applyingRequestedConversationRef.current = '';
      if (invalidConversationRef.current !== requestedConversationId) {
        invalidConversationRef.current = requestedConversationId;
        notifyInfo?.('Чат из ссылки недоступен или вы больше не являетесь его участником.', { title: 'Чат недоступен' });
      }
      clearStoredConversationState({ conversationId: requestedConversationId, invalidateThread: true });
      if (isMobile) setMobileView('inbox');
      navigate('/chat', { replace: true });
      return;
    }

    if (!requestedConversationId) {
      requestedConversationHandledRef.current = '';
      applyingRequestedConversationRef.current = '';
    }
    if (activeConversationId && conversations.some((item) => item.id === activeConversationId)) return;
    if (activeConversationId) {
      clearStoredConversationState({ conversationId: activeConversationId, invalidateThread: true });
    }
    cancelPendingInitialAnchor();
    setActiveConversationId('');
    if (isMobile) setMobileView('inbox');
  }, [activeConversationId, cancelPendingInitialAnchor, clearStoredConversationState, composePrefillRequested, conversationBootstrapComplete, conversations, conversationsLoading, isMobile, loadConversations, navigate, notifyInfo, requestedConversationId, restoredConversationId, restoredMobileView, writeMobileHistoryState]);

  useEffect(() => {
    if (!conversationBootstrapComplete) return;
    if (isMobile) return;
    const currentParams = new URLSearchParams(location.search);
    const currentConversation = String(currentParams.get('conversation') || '').trim();
    const nextConversation = String(activeConversationId || '').trim();
    const applyingRequestedConversationId = String(applyingRequestedConversationRef.current || '').trim();
    if (shouldDeferChatUrlSyncForRequestedConversation({
      applyingRequestedConversationId,
      activeConversationId: nextConversation,
    })) {
      return;
    }
    if (applyingRequestedConversationId && nextConversation === applyingRequestedConversationId) {
      applyingRequestedConversationRef.current = '';
    }
    if (currentConversation === nextConversation) return;
    if (nextConversation) currentParams.set('conversation', nextConversation);
    else currentParams.delete('conversation');
    const nextSearch = currentParams.toString();
    navigate({ pathname: '/chat', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [activeConversationId, conversationBootstrapComplete, isMobile, location.search, navigate]);

  useChatActiveThreadPolling({
    activeConversationId,
    activeConversationIdRef,
    activeThreadTransportState,
    buildActiveThreadPollLoadOptions,
    conversationBootstrapComplete,
    degradedThreadRevalidateCountRef,
    incrementalPollMs: ACTIVE_THREAD_INCREMENTAL_POLL_MS,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    listPollMs: LIST_POLL_MS,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    sidebarSearchActive,
    shouldPollActiveThreadIncrementally,
    threadPollMs: THREAD_POLL_MS,
  });

  useChatAiStatusPolling({
    activeConversationId,
    activeConversationKind: activeConversation?.kind,
    activeThreadTransportState,
    aiStatus: activeAiStatus,
    canUseAiChat,
    intervalMs: socketStatus === 'connected' ? AI_ACTIVE_POLL_WS_CONNECTED_MS : AI_ACTIVE_POLL_MS,
    mergeAiStatusPayload,
    setAiStatusByConversation,
    shouldPollActiveAiThread,
    socketStatus,
  });

  useChatSocketLifecycle({
    watchedPresenceUserIds,
    watchedPresenceUserIdsKey,
  });

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!normalizedConversationId || (!contextPanelOpen && !infoOpen)) return undefined;
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    void loadConversationDetail(normalizedConversationId, { signal: abortController?.signal }).catch(() => {});
    return () => {
      try {
        abortController?.abort?.();
      } catch {
        // Ignore detail abort cleanup failures.
      }
    };
  }, [activeConversationId, contextPanelOpen, infoOpen, loadConversationDetail]);

  useChatSocketEvents({
    activeConversation,
    activeConversationIdRef,
    aiRunStartedAtByConversationRef,
    applyMessageReadDelta,
    buildActiveThreadPollLoadOptions,
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation,
    hasPersistedThreadMessageEquivalent,
    lastConversationsLoadAtRef,
    latestActiveThreadSocketMessageRef,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebug,
    logChatDebugRef,
    markConversationReadLiveRef,
    markSocketActivity,
    mergeAiStatusPayload,
    mergeMessageIntoThread,
    messagesLoadingRef,
    messagesRef,
    onConversationRemoved: handleRemoteConversationRemoved,
    promoteConversationToTop,
    queueAutoScroll,
    setAiStatusByConversation,
    setMessages,
    setSocketStatus,
    setTypingUsers,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    shouldSkipActiveThreadRevalidate,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    socketStatusRef,
    syncConversationPreview,
    threadNearBottomRef,
    typingParticipantsTimeoutsRef,
    updatePresenceInCollections,
    upsertConversation,
    userId: user?.id,
  });

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    if (!activeConversationId) {
      setTypingUsers([]);
      return undefined;
    }
    chatSocket.subscribeConversation(activeConversationId);
    return () => {
      if (typingStartedRef.current) {
        chatSocket.sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
      chatSocket.unsubscribeConversation(activeConversationId);
      setTypingUsers([]);
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED || !activeConversationId) return undefined;
    const normalizedMessageText = String(deferredMessageText || '').trim();
    if (!normalizedMessageText) {
      if (typingStartedRef.current) {
        chatSocket.sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      return undefined;
    }
    if (!typingStartedRef.current) {
      chatSocket.sendTyping(activeConversationId, true);
      typingStartedRef.current = true;
    }
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      chatSocket.sendTyping(activeConversationId, false);
      typingStartedRef.current = false;
      typingStopTimeoutRef.current = null;
    }, 1800);
    return undefined;
  }, [activeConversationId, deferredMessageText]);

  useLayoutEffect(() => {
    let cancelled = false;
    let retryFrameId = null;
    const restore = prependScrollRestoreRef.current;
    if (restore && threadScrollRef.current) {
      const container = threadScrollRef.current;
      const anchorMessageId = String(restore.anchorMessageId || '').trim();
      const anchorNode = anchorMessageId
        ? container.querySelector?.(`[data-chat-message-id="${anchorMessageId}"]`)
        : null;
      const nextScrollHeight = container.scrollHeight;
      if (anchorNode) {
        setThreadScrollTop(Math.max(
          0,
          Number(container.scrollTop || 0) + (Number(anchorNode.offsetTop || 0) - Number(restore.anchorTop || 0)),
        ), { source: 'prependRestore:anchor' });
      } else {
        setThreadScrollTop(nextScrollHeight - restore.scrollHeight + restore.scrollTop, {
          source: 'prependRestore:scrollHeight',
        });
      }
      prependScrollRestoreRef.current = null;
      return;
    }
    const scrollMode = autoScrollRef.current;
    const scrollMeta = autoScrollMetaRef.current;
    const hasPendingInitialAnchor = pendingInitialAnchorRef.current?.conversationId === activeConversationIdRef.current;
    if (!scrollMode && !hasPendingInitialAnchor) return;
    const container = threadScrollRef.current;
    if (!container) return;

    if (scrollMode) {
      autoScrollRef.current = false;
      autoScrollMetaRef.current = null;
      if (scrollMeta?.userInitiated) {
        cancelPendingInitialAnchor();
      }
      const autoScrollSource = String(scrollMeta?.source || '').trim();
      const tracedScrollSource = autoScrollSource
        ? `autoScroll:${scrollMode}:${autoScrollSource}`
        : `autoScroll:${scrollMode}`;
      // #region agent log
      emitAgentDebugLog({
        location: 'Chat.jsx:autoScrollLayoutEffect',
        message: 'autoScroll prioritized over pendingAnchor',
        data: {
          mode: scrollMode,
          source: autoScrollSource || 'unknown',
          userInitiated: Boolean(scrollMeta?.userInitiated),
          hadPendingAnchor: hasPendingInitialAnchor,
        },
        hypothesisId: 'H5',
      });
      // #endregion
      if (scrollMode === 'bottom_instant') {
        const container = threadScrollRef.current;
        const isSocketSource = autoScrollSource.startsWith('socket:');
        const layoutKeyboardNow = isPhone && isChatLayoutKeyboardOpen(container);
        const needsMobileKeyboardDefer = isPhone && (layoutKeyboardNow || isSocketSource);
        const userInitiated = Boolean(scrollMeta?.userInitiated);
        const conversationId = String(activeConversationIdRef.current || '').trim();

        const runInstantScroll = (sourceSuffix = '') => {
          scrollThreadToBottomInstant({
            source: sourceSuffix ? `${tracedScrollSource}${sourceSuffix}` : tracedScrollSource,
            userInitiated,
            settleFrames: getChatBottomInstantSettleFrames({
              userInitiated,
              mobileKeyboardDeferred: needsMobileKeyboardDefer,
            }),
          });
        };

        if (needsMobileKeyboardDefer) {
          // #region agent log
          emitAgentDebugLog({
            location: 'Chat.jsx:autoScrollLayoutEffect',
            message: isSocketSource && !userInitiated
              ? 'deferred socket/layout-keyboard autoScroll'
              : 'mobile keyboard follow-up autoScroll scheduled',
            data: {
              source: autoScrollSource,
              layoutKeyboardNow,
              userInitiated,
              clientHeight: Math.round(Number(container?.clientHeight || 0)),
            },
            hypothesisId: 'H-M9',
          });
          // #endregion
          if (isSocketSource && !userInitiated) {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                if (String(activeConversationIdRef.current || '').trim() !== conversationId) return;
                runInstantScroll(':deferred-rAF');
                scheduleMobileKeyboardBottomSettle({
                  conversationId,
                  source: tracedScrollSource,
                  userInitiated,
                });
              });
            });
          } else {
            runInstantScroll();
            scheduleMobileKeyboardBottomSettle({
              conversationId,
              source: tracedScrollSource,
              userInitiated,
            });
          }
        } else {
          runInstantScroll();
        }
        logChatDebug('autoScroll:bottom_instant', {
          conversationId: activeConversationIdRef.current,
          source: autoScrollSource || 'unknown',
          userInitiated: Boolean(scrollMeta?.userInitiated),
        });
        return;
      }
      if (scrollMode === 'bottom') {
        threadNearBottomRef.current = true;
        showJumpToLatestRef.current = false;
        setShowJumpToLatest(false);
      }
      logChatDebug('autoScroll:bottom', {
        conversationId: activeConversationIdRef.current,
        source: autoScrollSource || 'unknown',
        userInitiated: Boolean(scrollMeta?.userInitiated),
      });
      if (scrollThreadBottomIntoView({ source: tracedScrollSource, behavior: 'smooth' })) return;
      return;
    }

    if (pendingInitialAnchorRef.current?.conversationId === activeConversationIdRef.current) {
      // Первичную позицию выставляем синхронно в layout-effect.
      // Предыдущий вариант через requestAnimationFrame давал браузеру шанс сначала
      // нарисовать чат в промежуточной позиции, а потом уже прыгнуть к нижнему якорю.
      queueMicrotask(() => {
        if (cancelled) return;
        const initialAnchorResult = applyPendingInitialAnchor({ source: 'layout_microtask' });
        if (initialAnchorResult === 'changed') {
          schedulePendingInitialAnchorSettle(true);
          return;
        }
        if (initialAnchorResult === 'unchanged') {
          schedulePendingInitialAnchorSettle(false);
          return;
        }
        retryFrameId = window.requestAnimationFrame(() => {
          queueMicrotask(() => {
            if (cancelled) return;
            const retryResult = applyPendingInitialAnchor({ source: 'layout_raf' });
            if (retryResult === 'changed') {
              schedulePendingInitialAnchorSettle(true);
              return;
            }
            if (retryResult === 'unchanged') {
              schedulePendingInitialAnchorSettle(false);
              return;
            }
            if (pendingInitialAnchorRef.current?.ready) {
              schedulePendingInitialAnchorRetry();
            }
          });
        });
      });
      return () => {
        cancelled = true;
        if (retryFrameId) window.cancelAnimationFrame(retryFrameId);
      };
    }
  }, [
    activeConversationId,
    applyPendingInitialAnchor,
    cancelPendingInitialAnchor,
    messages,
    schedulePendingInitialAnchorSettle,
    schedulePendingInitialAnchorRetry,
    logChatDebug,
    scrollThreadBottomIntoView,
    scrollThreadToBottomInstant,
    scheduleMobileKeyboardBottomSettle,
    setThreadScrollTop,
    isPhone,
  ]);

  useEffect(() => {
    if (!isMobile || mobileView !== 'thread' || activeConversationId) return;
    setMobileView('inbox');
  }, [activeConversationId, isMobile, mobileView]);

  useEffect(() => {
    if (!isMobile || mobileView !== 'thread') return;
    if (!conversationBootstrapComplete || messagesLoading) return;
    if (activeConversation) return;
    setMobileView('inbox');
  }, [activeConversation, conversationBootstrapComplete, isMobile, messagesLoading, mobileView]);

  useEffect(() => {
    if (!isMobile || resolvedMobileView === 'thread') return;
    if (!infoOpen) return;
    setInfoOpen(false);
  }, [infoOpen, isMobile, resolvedMobileView]);

  const openConversation = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    logChatDebug('openConversation', {
      conversationId: normalizedConversationId,
    });
    void prefetchThreadBootstrap(normalizedConversationId);
    if (normalizedConversationId && normalizedConversationId === String(activeConversationIdRef.current || '').trim()) {
      void loadThreadBootstrap(normalizedConversationId, {
        silent: true,
        reason: 'openConversation:active-refresh',
        force: true,
      });
    }
    setInfoOpen(false);
    setActiveConversationId(normalizedConversationId);
    resetMessageSearch();
    if (isMobile) {
      openMobileThreadView(normalizedConversationId);
      resetSidebarSearch();
    }
  }, [isMobile, loadThreadBootstrap, logChatDebug, openMobileThreadView, prefetchThreadBootstrap, resetMessageSearch, resetSidebarSearch]);

  const handleOpenPeer = useCallback(async (peer) => {
    const peerId = Number(peer?.id || 0);
    if (!Number.isFinite(peerId) || peerId <= 0) return;
    setOpeningPeerId(String(peerId));
    try {
      const created = await chatAPI.createDirectConversation(peerId);
      resetSidebarSearch();
      const items = await loadConversations({ silent: true, force: true });
      const createdId = String(created?.id || '');
      const nextConversationId = items.find((item) => item.id === createdId)?.id || createdId || '';
      setInfoOpen(false);
      setActiveConversationId(nextConversationId);
      if (isMobile) openMobileThreadView(nextConversationId);
      focusComposer();
    } catch (error) {
      notifyApiError(error, 'Не удалось открыть личный диалог.');
    } finally {
      setOpeningPeerId('');
    }
  }, [focusComposer, isMobile, loadConversations, notifyApiError, openMobileThreadView, resetSidebarSearch]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED) return;
    const searchParams = new URLSearchParams(location.search || '');
    if (searchParams.get('compose') !== 'prefill') {
      shareComposePrefillHandledRef.current = false;
      return;
    }
    if (shareComposePrefillHandledRef.current) return;
    shareComposePrefillHandledRef.current = true;

    const stripComposeFromUrl = () => {
      searchParams.delete('compose');
      const nextSearch = searchParams.toString();
      navigate({ pathname: '/chat', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
    };

    const prefill = readChatComposePrefill();
    if (!prefill?.peerUserId || !prefill.bodyText) {
      clearChatComposePrefill();
      stripComposeFromUrl();
      return;
    }

    const peerId = Number(prefill.peerUserId);
    const bodyText = String(prefill.bodyText || '');

    (async () => {
      try {
        const created = await chatAPI.createDirectConversation(peerId);
        resetSidebarSearch();
        const items = await loadConversations({ silent: true, force: true });
        const createdId = String(created?.id || '');
        const nextConversationId = items.find((item) => item.id === createdId)?.id || createdId || '';
        if (nextConversationId) {
          shareComposeDraftRef.current = {
            conversationId: nextConversationId,
            bodyText,
          };
          openConversation(nextConversationId);
          window.setTimeout(() => {
            focusComposer();
          }, 0);
        }
      } catch (error) {
        notifyApiError(error, 'Не удалось открыть чат для отправки файла.');
      } finally {
        clearChatComposePrefill();
        stripComposeFromUrl();
      }
    })();
  }, [
    focusComposer,
    loadConversations,
    location.search,
    navigate,
    notifyApiError,
    openConversation,
    resetSidebarSearch,
  ]);

  const handleOpenAiBot = useCallback(async (bot) => {
    const botId = String(bot?.id || '').trim();
    if (!botId) return;
    const existingConversationId = String(bot?.conversation_id || '').trim();
    if (existingConversationId) {
      openConversation(existingConversationId);
      focusComposer();
      return;
    }
    setOpeningAiBotId(botId);
    try {
      const conversation = await chatAPI.openAiBotConversation(botId);
      if (conversation?.id) {
        const normalizedConversationId = String(conversation.id).trim();
        upsertConversation(conversation, { promote: true });
        setAiBots((current) => current.map((item) => (
          String(item?.id || '').trim() === botId
            ? { ...item, conversation_id: normalizedConversationId }
            : item
        )));
        setAiStatusByConversation((current) => ({
          ...current,
          [normalizedConversationId]: {
            conversation_id: normalizedConversationId,
            bot_id: botId,
            bot_title: String(bot?.title || '').trim(),
            status: null,
            run_id: null,
            error_text: null,
            updated_at: null,
          },
        }));
        openConversation(normalizedConversationId);
        focusComposer();
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось открыть AI-чат.');
    } finally {
      setOpeningAiBotId('');
    }
  }, [focusComposer, notifyApiError, openConversation, upsertConversation]);

  const { handleComposerSend, sendMessage } = useChatComposerSending({
    activeConversation,
    activeConversationId,
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticTextMessage,
    draftWriteTimeoutRef,
    editingMessage,
    flushDraftToStorage,
    focusComposer,
    latestMessageTextRef,
    logChatDebug,
    mergeMessageIntoThread,
    messageText,
    notifyApiError,
    readSelectedDatabaseId,
    removeThreadMessage,
    replyMessage,
    setEditingMessage,
    setMessageText,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    setSocketStatus,
    socketStatusRef,
    userId: user?.id,
  });

  const patchAiActionCard = useCallback((messageId, actionCard) => {
    const normalizedMessageId = String(messageId || actionCard?.message_id || '').trim();
    if (!normalizedMessageId || !actionCard) return;
    patchThreadMessage(normalizedMessageId, { action_card: actionCard });
  }, [patchThreadMessage]);

  const [mailActionEditor, setMailActionEditor] = useState(null);

  const confirmAiAction = useCallback(async (actionCard, message, payloadOverrides = undefined) => {
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    try {
      const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
      patchAiActionCard(message?.id, updated);
      if (String(updated?.status || '').trim() === 'expired') {
        notifyApiError(new Error('Срок действия карточки истек.'), 'Действие не выполнено.');
      } else if (String(updated?.status || '').trim() === 'failed') {
        notifyApiError(new Error(updated?.error_text || 'Ошибка выполнения.'), 'Действие не выполнено.');
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось подтвердить действие ITinvent.');
    }
  }, [notifyApiError, patchAiActionCard]);

  const editAiAction = useCallback((actionCard, message) => {
    if (!String(actionCard?.action_type || '').startsWith('office.mail.')) return;
    setMailActionEditor({ actionCard, message });
  }, []);

  const chatMailAttachmentOptions = useMemo(() => (
    (Array.isArray(messages) ? messages : []).flatMap((message) => (
      (Array.isArray(message?.attachments) ? message.attachments : []).map((attachment) => ({
        message_id: String(message?.id || '').trim(),
        attachment_id: String(attachment?.id || '').trim(),
        file_name: String(attachment?.file_name || attachment?.name || '').trim(),
        file_size: Number(attachment?.file_size || attachment?.size || 0) || 0,
      }))
    )).filter((item) => item.message_id && item.attachment_id)
  ), [messages]);

  const submitMailActionEdit = useCallback(async (payloadOverrides) => {
    const actionCard = mailActionEditor?.actionCard;
    const message = mailActionEditor?.message;
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
    patchAiActionCard(message?.id, updated);
    if (String(updated?.status || '').trim() !== 'confirmed') {
      throw new Error(updated?.error_text || 'Письмо не отправлено.');
    }
    setMailActionEditor(null);
  }, [mailActionEditor, patchAiActionCard]);

  const cancelAiAction = useCallback(async (actionCard, message) => {
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    try {
      const updated = await chatAPI.cancelAiAction(actionId);
      patchAiActionCard(message?.id, updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось отменить действие ITinvent.');
    }
  }, [notifyApiError, patchAiActionCard]);

  const { shareTask: shareTaskFromHook } = useChatTaskSharing({
    activeConversationId,
    applyOutgoingThreadMessage,
    cancelPendingInitialAnchor,
    logChatDebug,
    notifyApiError,
    replyMessage,
    resetShareDialog,
    setReplyMessage,
    setSharingTaskId,
  });

  const {
    clearSelectedFiles,
    closeFileDialog,
    handleSelectFiles,
    openFilePicker,
    openMediaPicker,
    queueSelectedFiles,
    removeSelectedFile,
    sendFiles,
  } = useChatFileSending({
    activeConversation,
    activeConversationId,
    applyOutgoingThreadMessage,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticFileMessage,
    fileCaption,
    fileInputRef,
    fileUploadAbortRef,
    loadChatDialogsModule,
    logChatDebug,
    mediaFileInputRef,
    notifyApiError,
    notifyWarning,
    patchThreadMessage,
    preparingFiles,
    removeThreadMessage,
    replyMessage,
    revokeObjectUrls,
    selectedFiles,
    selectedUploadItems,
    sendingFiles,
    setComposerMenuAnchor,
    setEmojiAnchorEl,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setOptimisticAiQueuedStatus,
    setPreparingFiles,
    setReplyMessage,
    setSelectedUploadItems,
    setSendingFiles,
    setThreadMenuAnchor,
  });

  const handleVoiceRecordingComplete = useCallback(async ({ file, duration, mimeType }) => {
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || !file) return;
    try {
      await chatAPI.sendFiles(conversationId, [{
        file,
        media_kind: 'audio',
        duration_seconds: duration,
        mime_type: mimeType || file.type || 'audio/webm',
      }], {});
    } catch (error) {
      notifyApiError(error, 'Не удалось отправить голосовое сообщение.');
    }
  }, [activeConversationId, notifyApiError]);

  const {
    voiceRecording,
    voiceRecordingDuration,
    voiceRecordingLevelRef,
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
  } = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    notifyWarning,
  });

  const handleComposerKeyDown = useCallback((event) => {
    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.nativeEvent?.isComposing
      || event.repeat
    ) {
      return;
    }
    event.preventDefault();
    void handleComposerSend();
  }, [handleComposerSend]);

  const openMessageReads = useCallback(async (message) => {
    void loadChatDialogsModule();
    const messageId = String(message?.id || '').trim();
    if (!messageId) return;
    setMessageReadsMessage(message || null);
    setMessageReadsItems([]);
    setMessageReadsLoading(true);
    setMessageReadsOpen(true);
    try {
      const data = await chatAPI.getMessageReads(messageId);
      setMessageReadsItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить список прочитавших.');
      setMessageReadsOpen(false);
    } finally {
      setMessageReadsLoading(false);
    }
  }, [notifyApiError]);

  const handleToggleReaction = useCallback(async (messageId, emoji) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId || !messageId || !emoji) return;
    try {
      const result = await chatAPI.toggleReaction(conversationId, messageId, emoji);
      if (result?.message_id && Array.isArray(result?.reactions)) {
        setMessages((current) => current.map((msg) => (
          msg.id === result.message_id ? { ...msg, reactions: result.reactions } : msg
        )));
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось поставить реакцию.');
    }
  }, [notifyApiError]);

  const {
    clearSelectedMessages,
    closeMessageMenu,
    handleCopyMessage,
    handleCopyMessageLink,
    handleEditFromMessageMenu,
    handleOpenAttachmentFromMessageMenu,
    handleOpenReadsFromMessageMenu,
    handleOpenTaskFromMessageMenu,
    handleReplyFromMessageMenu,
    handleReplyMessage,
    handleReportMessageFromMenu,
    handleSelectMessageFromMenu,
    handleTogglePinMessageFromMenu,
    openMessageMenu,
    startMessageSelection,
    toggleMessageSelection,
  } = useChatMessageMenuActions({
    activeConversationIdRef,
    buildPinnedMessagePayload,
    focusComposer,
    loadChatDialogsModule,
    notifyInfo,
    notifyWarning,
    openMediaViewer,
    openMessageReads,
    openTaskFromChat,
    persistPinnedMessage,
    pinnedMessage,
    setComposerMenuAnchor,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setEditingMessage,
    setMessageText,
    setReplyMessage,
    setSelectedMessageIds,
    setThreadMenuAnchor,
  });

  const handleDeleteMessageFromMenu = useCallback(async (message) => {
    const conversationId = String(message?.conversation_id || activeConversationIdRef.current || '').trim();
    const messageId = String(message?.id || '').trim();
    closeMessageMenu();
    if (!conversationId || !messageId) return;
    if (typeof window !== 'undefined' && !window.confirm('Удалить сообщение?')) return;
    try {
      const updated = await chatAPI.deleteChatMessage(conversationId, messageId);
      // #region agent log
      fetch('http://127.0.0.1:7567/ingest/0dd98d48-9716-48e2-8a2d-050e49aa7cea',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'891634'},body:JSON.stringify({sessionId:'891634',location:'Chat.jsx:handleDeleteMessageFromMenu',message:'message deleted',data:{conversationId,messageId,isDeleted:Boolean(updated?.is_deleted)},timestamp:Date.now(),runId:'edit-delete',hypothesisId:'MSG-DELETE'})}).catch(()=>{});
      // #endregion
      mergeMessageIntoThread(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить сообщение.');
    }
  }, [closeMessageMenu, mergeMessageIntoThread, notifyApiError]);

  const {
    copySelectedMessages: selectedCopySelectedMessages,
    openForwardSelectedMessages: selectedOpenForwardSelectedMessages,
    replyToSelectedMessage: selectedReplyToSelectedMessage,
  } = useChatSelectedMessageActions({
    clearSelectedMessages,
    focusComposer,
    loadChatDialogsModule,
    normalizeForwardMessageQueue,
    notifyWarning,
    selectedMessages,
    setComposerMenuAnchor,
    setForwardConversationQuery,
    setForwardMessages,
    setForwardOpen,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setReplyMessage,
    setThreadMenuAnchor,
  });

  const {
    handleForwardMessageFromMenu: forwardHookMessageFromMenu,
    handleForwardMessageToConversation: forwardHookMessageToConversation,
  } = useChatForwardMessages({
    activeConversationIdRef,
    clearSelectedMessages,
    closeMessageMenu,
    forwardMessages,
    forwardingConversationId,
    loadChatDialogsModule,
    loadConversations,
    normalizeForwardMessageQueue,
    notifyApiError,
    openConversation,
    promoteConversationToTop,
    queueAutoScroll,
    setComposerMenuAnchor,
    setForwardConversationQuery,
    setForwardMessages,
    setForwardOpen,
    setForwardingConversationId,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setReplyMessage,
    setThreadMenuAnchor,
    syncConversationPreview,
    upsertThreadMessages,
  });

  const handleUnpinPinnedMessage = useCallback(() => {
    persistPinnedMessage(null);
  }, [persistPinnedMessage]);

  const clearReplyMessage = useCallback(() => {
    setReplyMessage(null);
    focusComposer();
  }, [focusComposer]);

  const clearEditingMessage = useCallback(() => {
    setEditingMessage(null);
    setMessageText('');
    focusComposer();
  }, [focusComposer]);

  const loadOlderMessages = useCallback(async () => {
    const firstMessageId = String(messagesRef.current[0]?.id || '').trim();
    if (!activeConversationId || !firstMessageId || loadingOlder || !messagesHasMore) return;
    const cursorKey = `${activeConversationId}:${firstMessageId}`;
    if (loadOlderInFlightCursorRef.current === cursorKey) return;
    loadOlderInFlightCursorRef.current = cursorKey;
    // #region agent log
    emitAgentDebugLog({
      location: 'Chat.jsx:loadOlderMessages',
      message: 'load older history requested',
      hypothesisId: 'H-HISTORY-WIPE',
      data: {
        conversationId: activeConversationId,
        firstMessageId,
        currentCount: messagesRef.current.length,
      },
    });
    // #endregion
    try {
      const olderItems = await loadMessages(activeConversationId, {
        silent: true,
        beforeMessageId: firstMessageId,
        reason: 'loadOlderMessages',
      });
      // #region agent log
      emitAgentDebugLog({
        location: 'Chat.jsx:loadOlderMessages',
        message: 'load older history completed',
        hypothesisId: 'H-HISTORY-WIPE',
        data: {
          conversationId: activeConversationId,
          firstMessageId,
          loadedCount: Array.isArray(olderItems) ? olderItems.length : 0,
          nextCount: messagesRef.current.length,
          messagesHasMore: messagesHasMoreRef.current,
        },
      });
      // #endregion
    } finally {
      if (loadOlderInFlightCursorRef.current === cursorKey) {
        loadOlderInFlightCursorRef.current = '';
      }
    }
  }, [activeConversationId, loadMessages, loadingOlder, messagesHasMore]);

  const handleThreadScroll = useCallback((event) => {
    const node = event?.currentTarget;
    if (!node) return;
    const pendingAnchor = pendingInitialAnchorRef.current;
    const lastAppliedTarget = Number(pendingAnchor?.lastAppliedTarget);
    const likelyManualScroll = suppressThreadScrollCancelRef.current
      && pendingAnchor?.conversationId === activeConversationIdRef.current
      && Number.isFinite(lastAppliedTarget)
      && Math.abs(Number(node.scrollTop || 0) - lastAppliedTarget) > 2;
    if (!suppressThreadScrollCancelRef.current || likelyManualScroll) {
      if (pendingAnchor?.conversationId === activeConversationIdRef.current) {
        logChatDebug('threadScroll:cancelPendingAnchor', {
          conversationId: pendingAnchor.conversationId,
          mode: pendingAnchor.mode,
          source: likelyManualScroll ? 'suppressed_manual_override' : 'user_scroll',
        });
        cancelPendingInitialAnchor();
      }
      if (isInitialViewportGuardActive(activeConversationIdRef.current)) {
        clearInitialViewportGuard(likelyManualScroll ? 'manual_scroll:suppressed_override' : 'manual_scroll');
      }
    }
    scheduleThreadViewportStateSync(node);
  }, [cancelPendingInitialAnchor, clearInitialViewportGuard, isInitialViewportGuardActive, logChatDebug, scheduleThreadViewportStateSync]);

  const jumpToLatest = useCallback(async () => {
    cancelPendingInitialAnchor();
    threadNearBottomRef.current = true;
    showJumpToLatestRef.current = false;
    setShowJumpToLatest(false);
    queueAutoScroll('bottom', 'jumpToLatest', { userInitiated: true });
    logChatDebug('jumpToLatest', {
      conversationId: activeConversationIdRef.current,
    });
    let iterations = 0;
    while (messagesHasNewerRef.current && iterations < 12) {
      if (!activeConversationIdRef.current) break;
      const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
      const newerItems = await loadMessages(activeConversationIdRef.current, {
        ...requestOptions,
        reason: requestOptions.afterMessageId ? 'jumpToLatest:loadNewer' : 'jumpToLatest:bootstrap',
      });
      if (!Array.isArray(newerItems) || newerItems.length === 0) break;
      iterations += 1;
    }
    scrollThreadBottomIntoView({ source: 'jumpToLatest:bottomRef', behavior: 'smooth' });
  }, [cancelPendingInitialAnchor, loadMessages, logChatDebug, queueAutoScroll, scrollThreadBottomIntoView]);

  const handleComposerPaste = useCallback((event) => {
    const files = Array.from(event?.clipboardData?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    void queueSelectedFiles(files);
  }, [queueSelectedFiles]);

  const handleComposerDragOver = useCallback((event) => {
    if (!event?.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileDragActive(true);
  }, []);

  const handleComposerDragLeave = useCallback((event) => {
    if (!event?.currentTarget?.contains(event?.relatedTarget)) {
      setFileDragActive(false);
    }
  }, []);

  const handleComposerDrop = useCallback((event) => {
    if (!event?.dataTransfer?.files?.length) return;
    event.preventDefault();
    setFileDragActive(false);
    void queueSelectedFiles(Array.from(event.dataTransfer.files || []));
  }, [queueSelectedFiles]);

  const closeForwardDialog = useCallback(() => {
    if (forwardingConversationId) return;
    setForwardOpen(false);
    setForwardConversationQuery('');
    setForwardMessages([]);
  }, [forwardingConversationId]);

  const closeMobileInfoView = useCallback(() => {
    if (!isMobile) {
      setInfoOpen(false);
      return;
    }
    const currentMobileHistoryState = typeof window !== 'undefined' && mobileHistoryReadyRef.current
      ? readMobileHistoryState()
      : null;
    if (currentMobileHistoryState?.view === 'thread' && currentMobileHistoryState?.infoOpen) {
      setInfoOpen(false);
      window.history.back();
      return;
    }
    setInfoOpen(false);
  }, [isMobile, readMobileHistoryState]);

  const handleOpenInfo = useCallback(() => {
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    if (isMobile) {
      void loadChatDialogsModule();
      const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
      setInfoOpen(true);
      if (!mobileHistoryReadyRef.current || typeof window === 'undefined' || !normalizedConversationId) return;
      const nextState = { view: 'thread', drawerOpen: false, infoOpen: true };
      const currentState = readMobileHistoryState();
      const currentConversationId = currentState?.view === 'thread' ? getCurrentBrowserConversationId() : '';
      const currentHistoryKey = currentState ? getMobileHistoryKey(currentState, currentConversationId) : '';
      const nextHistoryKey = getMobileHistoryKey(nextState, normalizedConversationId);
      if (currentHistoryKey === nextHistoryKey) return;
      writeMobileHistoryState(nextState, 'push', normalizedConversationId);
      return;
    }
    void loadChatContextPanelModule();
    setContextPanelOpen((current) => !current);
  }, [getCurrentBrowserConversationId, getMobileHistoryKey, isMobile, readMobileHistoryState, writeMobileHistoryState]);

  const mobileScreenVariants = useMemo(
    () => buildChatMobileScreenVariants({ motionDisabled: mobileMotionDisabled }),
    [mobileMotionDisabled],
  );

  const sidebarPane = (
    <ChatSidebar
      theme={theme}
      ui={ui}
      isMobile={isMobile}
      compactMobile={isPhone}
      disableMotion={mobileMotionDisabled}
      health={health}
      user={user}
      unreadTotal={unreadTotal}
      sidebarQuery={sidebarQuery}
      onSidebarQueryChange={setSidebarQuery}
      sidebarSearchActive={sidebarSearchActive}
      searchingSidebar={searchingSidebar}
      searchPeople={searchPeople}
      searchChats={searchChats}
      searchResultEmpty={searchResultEmpty}
      openingPeerId={openingPeerId}
      onOpenPeer={handleOpenPeer}
      activeConversationId={activeConversationId}
      onOpenConversation={openConversation}
      onPrefetchConversation={prefetchThreadBootstrap}
      conversationsLoading={conversationsLoading}
      conversations={filteredConversations}
      onOpenGroup={openGroupDialog}
      sidebarScrollRef={sidebarScrollRef}
      activeFolderKey={conversationFilter}
      onActiveFolderChange={handleActiveFolderChange}
      customFolders={customFolders}
      folderUnreadCounts={conversationFilterCounts}
      conversationIdsByFolder={conversationIdsByFolder}
      onOpenFolderManager={handleOpenFolderManager}
      onOpenArchive={handleOpenArchiveFolder}
      onToggleConversationInFolder={handleToggleConversationInFolder}
      draftsByConversation={draftsByConversation}
      onUpdateConversationSettings={updateConversationSettings}
      aiBots={aiSidebarRows}
      aiBotsLoading={aiBotsLoading}
      aiBotsError={aiBotsError}
      showAiSection={canUseAiChat}
      onOpenAiBot={handleOpenAiBot}
      openingAiBotId={openingAiBotId}
    />
  );

  const handleOpenMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(event.currentTarget);
  }, []);

  const handleOpenComposerMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setComposerMenuAnchor(event.currentTarget);
    if (isMobile) focusComposer({ forceMobile: true });
  }, [isMobile, focusComposer]);

  const handleOpenEmojiPicker = useCallback((event) => {
    void loadChatDialogsModule();
    syncComposerSelection();
    if (isMobile) {
      composerRef.current?.blur?.();
    }
    setEmojiAnchorEl(event.currentTarget);
  }, [isMobile, syncComposerSelection]);

  const handleCloseEmojiPicker = useCallback(() => {
    setEmojiAnchorEl(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
    });
  }, []);

  const handleComposerFocusChange = useCallback((focused) => {
    if (focused && isMobile && emojiAnchorEl) {
      setEmojiAnchorEl(null);
    }
  }, [isMobile, emojiAnchorEl]);

  const handleSendGif = useCallback(async (gif) => {
    if (!gif?.fullUrl) return;
    try {
      const resp = await fetch(gif.fullUrl);
      const blob = await resp.blob();
      const name = (gif.title || 'animation').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '.gif';
      const file = new File([blob], name, { type: 'image/gif' });
      setEmojiAnchorEl(null);
      await queueSelectedFiles([file]);
    } catch {
      setMessageText(gif.fullUrl);
      window.requestAnimationFrame(() => handleComposerSend());
    }
  }, [queueSelectedFiles, handleComposerSend]);

  const threadPane = (
    <ChatThread
      theme={theme}
      ui={ui}
      isMobile={isMobile}
      compactMobile={isPhone}
      mobileInteractionsEnabled={isMobile}
      activeConversation={activeConversation}
      activeConversationId={activeConversationId}
      navigate={navigate}
      threadWallpaperSx={threadWallpaperSx}
      messages={messages}
      messagesLoading={messagesLoading}
      effectiveLastReadMessageId={effectiveLastReadMessageId}
      messagesHasMore={messagesHasMore}
      loadingOlder={loadingOlder}
      onLoadOlder={loadOlderMessages}
      threadScrollRef={threadScrollRef}
      threadContentRef={threadContentRef}
      onThreadScroll={handleThreadScroll}
      bottomRef={bottomRef}
      onBack={openMobileInboxView}
      onOpenInfo={handleOpenInfo}
      onOpenTask={openTaskFromChat}
      onOpenSearch={openSearchDialog}
      onOpenMenu={handleOpenMenu}
      onOpenReads={openMessageReads}
      onOpenAttachmentPreview={openMediaViewer}
      onReplyMessage={handleReplyMessage}
      onOpenMessageMenu={openMessageMenu}
      onConfirmAction={confirmAiAction}
      onCancelAction={cancelAiAction}
      onEditAction={editAiAction}
      selectedMessageIds={selectedVisibleMessageIds}
      selectedMessageCount={selectedMessageCount}
      canReplySelectedMessage={selectedMessageCount === 1}
      canCopySelectedMessages={canCopySelectedMessages}
      onToggleMessageSelection={toggleMessageSelection}
      onStartMessageSelection={startMessageSelection}
      onClearMessageSelection={clearSelectedMessages}
      onReplySelectedMessage={selectedReplyToSelectedMessage}
      onCopySelectedMessages={selectedCopySelectedMessages}
      onForwardSelectedMessages={selectedOpenForwardSelectedMessages}
      onOpenComposerMenu={handleOpenComposerMenu}
      composerRef={composerRef}
      messageText={messageText}
      onMessageTextChange={setMessageText}
      onComposerKeyDown={handleComposerKeyDown}
      onComposerSelectionSync={syncComposerSelection}
      onOpenEmojiPicker={handleOpenEmojiPicker}
      onCloseEmojiPicker={handleCloseEmojiPicker}
      onComposerFocusChange={handleComposerFocusChange}
      onSendMessage={handleComposerSend}
      onComposerPaste={handleComposerPaste}
      onComposerDrop={handleComposerDrop}
      onComposerDragOver={handleComposerDragOver}
      onComposerDragLeave={handleComposerDragLeave}
      mentionCandidates={mentionCandidates}
      onSearchMentionPeople={searchMentionPeople}
      isFileDragActive={fileDragActive}
      showJumpToLatest={showJumpToLatest}
      onJumpToLatest={jumpToLatest}
      replyMessage={replyMessage}
      onClearReply={clearReplyMessage}
      editingMessage={editingMessage}
      onClearEditing={clearEditingMessage}
      aiTypingStatus={aiTypingStatus}
      aiStatus={activeConversation?.kind === 'ai' ? activeAiStatus : null}
      pinnedMessage={pinnedMessage}
      onOpenPinnedMessage={handleOpenPinnedMessage}
      onUnpinPinnedMessage={handleUnpinPinnedMessage}
      highlightedMessageId={highlightedMessageId}
      headerSubtitle={conversationMetaSubtitle}
      typingLine={aiAwareTypingLine}
      contextPanelOpen={showContextPanel}
      selectedFiles={selectedFiles}
      fileCaption={fileCaption}
      onOpenFileDialog={openFilePicker}
      onClearSelectedFiles={clearSelectedFiles}
      preparingFiles={preparingFiles}
      sendingFiles={sendingFiles}
      fileUploadProgress={fileUploadProgress}
      selectedFilesSummary={selectedFilesSummary}
      getReadTargetRef={getReadTargetRef}
      onToggleReaction={handleToggleReaction}
      onScrollToMessage={scrollToMessage}
      currentUserId={user?.id}
      mobileEmojiPickerOpen={isMobile && emojiPickerOpen}
      onInsertEmoji={insertEmojiAtSelection}
      onSendSticker={insertEmojiAtSelection}
      onSendGif={handleSendGif}
      voiceRecording={voiceRecording}
      voiceRecordingDuration={voiceRecordingDuration}
      voiceRecordingLevelRef={voiceRecordingLevelRef}
      onStartVoiceRecording={startVoiceRecording}
      onStopVoiceRecording={stopVoiceRecording}
      onCancelVoiceRecording={cancelVoiceRecording}
      onBindPinnedScroll={bindPinnedScroll}
    />
  );

  return (
    <MainLayout
      headerMode={isPhone ? 'hidden' : 'default'}
      mobileBottomNavMode={resolveChatMobileBottomNavMode(isMobile, mobileBottomNavHidden)}
      mobileBottomNavTransitionMs={CHAT_MOBILE_SCREEN_TRANSITION_MS}
    >
      <PageShell
        sx={{
          bgcolor: isPhone ? ui.threadBg : ui.pageBg,
          gap: isPhone ? 0 : 1.5,
          height: '100%',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          overscrollBehaviorY: 'none',
        }}
      >
        <Stack spacing={isPhone ? 0 : 1.5} sx={{ flex: 1, minHeight: 0 }}>
          <input
            ref={fileInputRef}
            data-testid="chat-file-input"
            type="file"
            hidden
            multiple
            accept={CHAT_FILE_ACCEPT}
            onChange={handleSelectFiles}
          />
          <input
            ref={mediaFileInputRef}
            data-testid="chat-media-file-input"
            type="file"
            hidden
            multiple
            accept="image/*,video/*"
            onChange={handleSelectFiles}
          />
          <AiMailActionEditDialog
            open={Boolean(mailActionEditor)}
            actionCard={mailActionEditor?.actionCard}
            availableAttachments={chatMailAttachmentOptions}
            onClose={() => setMailActionEditor(null)}
            onSubmit={submitMailActionEdit}
          />
          {!CHAT_FEATURE_ENABLED ? (
            <Alert severity="info" sx={{ borderRadius: isPhone ? 0 : 3, py: isPhone ? 0.15 : undefined }}>
              Раздел Chat скрыт feature flag `VITE_CHAT_ENABLED`.
            </Alert>
          ) : null}
          {healthError ? (
            <Alert severity="warning" sx={{ borderRadius: isPhone ? 0 : 3, py: isPhone ? 0.15 : undefined }}>
              {healthError}
            </Alert>
          ) : null}
          {activeAiLiveDataNotice ? (
            <Alert severity={activeAiLiveDataNotice.severity} sx={{ borderRadius: isPhone ? 0 : 3, py: isPhone ? 0.15 : undefined }}>
              {activeAiLiveDataNotice.text}
            </Alert>
          ) : null}

          <Paper
            elevation={0}
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: isPhone ? 0 : 1.5,
              border: isPhone ? 'none' : `1px solid ${ui.desktopShellBorder || ui.borderSoft}`,
              bgcolor: isPhone ? ui.threadBg : ui.panelBg,
              boxShadow: isPhone ? 'none' : `0 18px 42px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.18 : 0.1)}`,
            }}
          >
            <Box
              sx={{
                display: isMobile ? 'block' : 'grid',
                gridTemplateColumns: isMobile
                  ? undefined
                  : `minmax(${ui.density.sidebarColumnMin}px, ${ui.density.sidebarColumnMax}px) minmax(0, 1fr)`,
                flex: 1,
                minHeight: 0,
              }}
            >
              {isMobile ? (
                <Box sx={{
                  position: 'relative',
                  minWidth: 0,
                  minHeight: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden',
                  display: 'flex',
                  flex: 1,
                  isolation: 'isolate',
                }}
                >
                  <AnimatePresence initial={false} custom={mobileTransitionDirection} mode="sync">
                    {resolvedMobileView === 'thread' ? (
                      <Box
                        key="chat-thread-screen"
                        component={motion.div}
                        custom={mobileTransitionDirection}
                        variants={mobileScreenVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={mobileScreenTransition}
                        onAnimationComplete={handleMobileThreadScreenAnimationComplete}
                        data-testid="chat-mobile-thread-screen"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          width: '100%',
                          height: '100%',
                          minHeight: 0,
                          zIndex: 2,
                          willChange: mobileMotionDisabled ? 'auto' : 'transform',
                          backfaceVisibility: 'hidden',
                        }}
                      >
                        {threadPane}
                      </Box>
                    ) : (
                      <Box
                        key="chat-inbox-screen"
                        component={motion.div}
                        custom={mobileTransitionDirection}
                        variants={mobileScreenVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={mobileScreenTransition}
                        data-testid="chat-mobile-inbox-screen"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          width: '100%',
                          height: '100%',
                          minHeight: 0,
                          zIndex: 1,
                          willChange: mobileMotionDisabled ? 'auto' : 'transform',
                          backfaceVisibility: 'hidden',
                        }}
                      >
                        {sidebarPane}
                      </Box>
                    )}
                  </AnimatePresence>
                </Box>
              ) : (
                <>
                  {sidebarPane}
                  <Box sx={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
                    {threadPane}

                    {renderDesktopContextPanel ? (
                      <>
                        <Box
                          onClick={() => setContextPanelOpen(false)}
                          sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            bottom: 0,
                            right: 0,
                            zIndex: 6,
                            bgcolor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                            opacity: showContextPanel ? 1 : 0,
                            pointerEvents: showContextPanel ? 'auto' : 'none',
                            transition: `opacity ${showContextPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${showContextPanel ? 'ease-out' : 'ease-in'}`,
                          }}
                        />
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            bottom: 0,
                            width: { md: 340, lg: 360 },
                            maxWidth: '100%',
                            zIndex: 7,
                            borderLeft: `1px solid ${ui.borderSoft}`,
                            boxShadow: ui.shadowStrong,
                            opacity: showContextPanel ? 1 : 0,
                            pointerEvents: showContextPanel ? 'auto' : 'none',
                            transform: showContextPanel ? 'translateX(0)' : 'translateX(24px)',
                            transition: `transform ${showContextPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${showContextPanel ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease-in'}, opacity ${showContextPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${showContextPanel ? 'ease-out' : 'ease-in'}`,
                            willChange: 'transform, opacity',
                          }}
                        >
                          <Suspense fallback={null}>
                            <LazyChatContextPanel
                              theme={theme}
                              ui={ui}
                              activeConversation={activeConversation}
                              conversationHeaderSubtitle={conversationMetaSubtitle}
                              socketStatus={socketStatus}
                              currentUser={user}
                              messages={messages}
                              open={showContextPanel}
                              embedded
                              onClose={() => setContextPanelOpen(false)}
                              onOpenSearch={openSearchDialog}
                              onOpenShare={openShareDialog}
                              onOpenFilePicker={openFilePicker}
                              onUpdateConversationSettings={updateConversationSettings}
                              onAddGroupMembers={handleAddGroupMembers}
                              onRemoveGroupMember={handleRemoveGroupMember}
                              onUpdateGroupMemberRole={handleUpdateGroupMemberRole}
                              onTransferGroupOwnership={handleTransferGroupOwnership}
                              onLeaveGroup={handleLeaveGroup}
                              onUpdateGroupProfile={handleUpdateGroupProfile}
                              settingsUpdating={settingsUpdating}
                              onOpenAttachmentPreview={openMediaViewer}
                              onOpenTask={openTaskFromChat}
                            />
                          </Suspense>
                        </Box>
                      </>
                    ) : null}
                  </Box>
                </>
              )}
            </Box>
          </Paper>

          {shouldRenderChatDialogs ? (
            <Suspense fallback={null}>
              <LazyChatDialogs
                theme={theme}
                ui={ui}
                activeConversation={activeConversation}
                activeConversationId={activeConversationId}
                currentUser={user}
                threadMenuAnchor={threadMenuAnchor}
                onCloseThreadMenu={() => setThreadMenuAnchor(null)}
                threadInfoOpen={isMobile ? infoOpen : showContextPanel}
                onOpenInfo={handleOpenInfo}
                messageMenuAnchor={messageMenuAnchor}
                messageMenuMessage={messageMenuMessage}
                onCloseMessageMenu={closeMessageMenu}
                onToggleReactionFromMenu={(msg, emoji) => msg?.id && handleToggleReaction(msg.id, emoji)}
                onReplyFromMessageMenu={handleReplyFromMessageMenu}
                onCopyMessage={handleCopyMessage}
                onTogglePinMessageFromMenu={handleTogglePinMessageFromMenu}
                messageMenuPinned={String(messageMenuMessage?.id || '').trim() === String(pinnedMessage?.id || '').trim()}
                onCopyMessageLink={handleCopyMessageLink}
                onForwardMessageFromMenu={forwardHookMessageFromMenu}
                onReportMessageFromMenu={handleReportMessageFromMenu}
                onDeleteMessageFromMenu={handleDeleteMessageFromMenu}
                onEditMessageFromMenu={handleEditFromMessageMenu}
                onSelectMessageFromMenu={handleSelectMessageFromMenu}
                onOpenReadsFromMessageMenu={handleOpenReadsFromMessageMenu}
                onOpenAttachmentFromMessageMenu={handleOpenAttachmentFromMessageMenu}
                onOpenTaskFromMessageMenu={handleOpenTaskFromMessageMenu}
                messages={messages}
                composerMenuAnchor={composerMenuAnchor}
                onCloseComposerMenu={() => setComposerMenuAnchor(null)}
                onOpenSearch={openSearchDialog}
                onOpenShare={openShareDialog}
                onOpenFilePicker={openFilePicker}
                onOpenMediaPicker={openMediaPicker}
                emojiPickerOpen={emojiPickerOpen}
                emojiAnchorEl={emojiAnchorEl}
                onCloseEmojiPicker={() => setEmojiAnchorEl(null)}
                onInsertEmoji={insertEmojiAtSelection}
                fileInputRef={fileInputRef}
                mediaFileInputRef={mediaFileInputRef}
                onSelectFiles={handleSelectFiles}
                fileDialogOpen={fileDialogOpen}
                onCloseFileDialog={closeFileDialog}
                selectedFiles={selectedFiles}
                fileCaption={fileCaption}
                onFileCaptionChange={setFileCaption}
                preparingFiles={preparingFiles}
                sendingFiles={sendingFiles}
                fileUploadProgress={fileUploadProgress}
                fileSummary={selectedFilesSummary}
                onSendFiles={sendFiles}
                onRemoveSelectedFile={removeSelectedFile}
                onClearSelectedFiles={clearSelectedFiles}
                groupOpen={groupOpen}
                onCloseGroup={closeGroupDialog}
                groupTitle={groupTitle}
                onGroupTitleChange={setGroupTitle}
                groupSearch={groupSearch}
                onGroupSearchChange={setGroupSearch}
                groupUsers={groupUsers}
                groupUsersLoading={groupUsersLoading}
                groupSelectedUsers={groupSelectedUsers}
                groupMemberIds={groupMemberIds}
                onAddGroupMember={addGroupMember}
                onRemoveGroupMember={removeGroupMember}
                creatingConversation={creatingConversation}
                groupCreateDisabled={groupCreateDisabled}
                onCreateGroup={createGroup}
                shareOpen={shareOpen}
                onCloseShare={resetShareDialog}
                taskSearch={taskSearch}
                onTaskSearchChange={setTaskSearch}
                shareableTasks={shareableTasks}
                shareableLoading={shareableLoading}
                sharingTaskId={sharingTaskId}
                onShareTask={shareTaskFromHook}
                forwardOpen={forwardOpen}
                onCloseForward={closeForwardDialog}
                forwardSelectionCount={forwardMessages.length}
                forwardConversationQuery={forwardConversationQuery}
                onForwardConversationQueryChange={setForwardConversationQuery}
                forwardTargets={forwardTargets}
                forwardTargetsLoading={false}
                forwardingConversationId={forwardingConversationId}
                onForwardMessageToConversation={forwardHookMessageToConversation}
                onOpenAttachmentPreview={openMediaViewer}
                attachmentPreview={attachmentPreview}
                onCloseAttachmentPreview={closeAttachmentPreview}
                documentPreview={documentPreview}
                onCloseDocumentPreview={closeDocumentPreview}
                onDownloadDocumentPreview={handleDownloadDocumentPreview}
                onDownloadDocumentPreviewPdf={handleDownloadDocumentPreviewPdf}
                messageReadsOpen={messageReadsOpen}
                onCloseMessageReads={() => setMessageReadsOpen(false)}
                messageReadsMessage={messageReadsMessage}
                messageReadsLoading={messageReadsLoading}
                messageReadsItems={messageReadsItems}
                infoOpen={isMobile && infoOpen}
                onCloseInfo={closeMobileInfoView}
                conversationHeaderSubtitle={conversationMetaSubtitle}
                settingsUpdating={settingsUpdating}
                onUpdateConversationSettings={updateConversationSettings}
                onAddGroupMembers={handleAddGroupMembers}
                onRemoveGroupParticipant={handleRemoveGroupMember}
                onUpdateGroupMemberRole={handleUpdateGroupMemberRole}
                onTransferGroupOwnership={handleTransferGroupOwnership}
                onLeaveGroup={handleLeaveGroup}
                onUpdateGroupProfile={handleUpdateGroupProfile}
                onOpenTask={openTaskFromChat}
                searchOpen={searchOpen}
                onCloseSearch={closeSearchDialog}
                messageSearch={messageSearch}
                onMessageSearchChange={setMessageSearch}
                messageSearchResults={messageSearchResults}
                messageSearchLoading={messageSearchLoading}
                messageSearchHasMore={messageSearchHasMore}
                onLoadMoreSearchResults={loadMoreSearchResults}
                onOpenSearchResult={openSearchResult}
              />
            </Suspense>
          ) : null}

          <ChatFolderDialogs
            open={folderManagerOpen}
            createMode={folderManagerCreateMode}
            folders={customFolders}
            conversations={conversations}
            conversationIdsByFolder={conversationIdsByFolder}
            saving={folderSaving || foldersLoading}
            onClose={() => {
              setFolderManagerOpen(false);
              setFolderManagerCreateMode(false);
            }}
            onCreateFolder={handleCreateChatFolder}
            onRenameFolder={handleRenameChatFolder}
            onDeleteFolder={handleDeleteChatFolder}
            onReorderFolder={handleReorderChatFolder}
            onRemoveConversationFromFolder={handleRemoveConversationFromFolder}
          />
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
