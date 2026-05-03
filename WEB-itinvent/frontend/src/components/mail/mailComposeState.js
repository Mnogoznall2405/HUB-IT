import { mergeQuotedHistoryHtml, splitQuotedHistoryHtml } from './mailQuotedHistory';

export const normalizeMailRecipient = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/<([^>]+)>/);
  return String(match?.[1] || text).trim();
};

export const toRecipientEmails = (values) => (
  Array.isArray(values)
    ? values
      .map((item) => (typeof item === 'string' ? item : item?.email || item?.name || ''))
      .map(normalizeMailRecipient)
      .filter(Boolean)
    : []
);

export const getComposeDialogTitle = (composeMode = 'new') => {
  if (composeMode === 'reply') return 'Ответ';
  if (composeMode === 'reply_all') return 'Ответ всем';
  if (composeMode === 'forward') return 'Пересылка';
  if (composeMode === 'draft') return 'Черновик';
  return 'Новое письмо';
};

export const createComposeInitialState = (overrides = {}) => ({
  composeMode: String(overrides.composeMode || 'new'),
  composeFromMailboxId: String(overrides.composeFromMailboxId || ''),
  composeToValues: toRecipientEmails(overrides.composeToValues ?? overrides.to ?? []),
  composeCcValues: toRecipientEmails(overrides.composeCcValues ?? overrides.cc ?? []),
  composeBccValues: toRecipientEmails(overrides.composeBccValues ?? overrides.bcc ?? []),
  composeSubject: String(overrides.composeSubject ?? overrides.subject ?? ''),
  composeBody: String(overrides.composeBody ?? overrides.body ?? ''),
  composeQuotedOriginalHtml: String(overrides.composeQuotedOriginalHtml ?? overrides.quotedOriginalHtml ?? ''),
  composeFiles: Array.isArray(overrides.composeFiles) ? [...overrides.composeFiles] : [],
  composeDraftAttachments: Array.isArray(overrides.composeDraftAttachments ?? overrides.draftAttachments)
    ? [...(overrides.composeDraftAttachments ?? overrides.draftAttachments)]
    : [],
  composeFieldErrors: { ...(overrides.composeFieldErrors || {}) },
  composeError: String(overrides.composeError || ''),
  composeSending: Boolean(overrides.composeSending),
  composeDraftId: String(overrides.composeDraftId ?? overrides.draftId ?? ''),
  composeReplyToMessageId: String(overrides.composeReplyToMessageId ?? overrides.replyToMessageId ?? ''),
  composeForwardMessageId: String(overrides.composeForwardMessageId ?? overrides.forwardMessageId ?? ''),
  composeUploadProgress: Number(overrides.composeUploadProgress || 0),
  composeDragActive: Boolean(overrides.composeDragActive),
  draftSyncState: String(overrides.draftSyncState || 'idle'),
  draftSavedAt: String(overrides.draftSavedAt || ''),
  dismissedComposeWarnings: Array.isArray(overrides.dismissedComposeWarnings)
    ? overrides.dismissedComposeWarnings.map((value) => String(value || '')).filter(Boolean)
    : [],
});

export const getComposeCombinedBody = (state) => mergeQuotedHistoryHtml(
  state?.composeBody || '',
  state?.composeQuotedOriginalHtml || '',
);

export const composeStateHasContent = (state) => Boolean(
  toRecipientEmails(state?.composeToValues).length
  || toRecipientEmails(state?.composeCcValues).length
  || toRecipientEmails(state?.composeBccValues).length
  || String(state?.composeSubject || '').trim()
  || String(getComposeCombinedBody(state) || '').replace(/<[^>]*>/g, '').trim()
  || Array.isArray(state?.composeFiles) && state.composeFiles.length > 0
  || Array.isArray(state?.composeDraftAttachments) && state.composeDraftAttachments.length > 0
);

const getDefaultStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const readStoredComposeState = ({
  composeDraftKey,
  resolveComposeMailboxId,
  storage = getDefaultStorage(),
} = {}) => {
  if (!storage || !composeDraftKey) return null;
  const resolveMailboxId = typeof resolveComposeMailboxId === 'function'
    ? resolveComposeMailboxId
    : (value) => String(value || '').trim();

  try {
    const raw = storage.getItem(composeDraftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const quotedOriginalHtml = String(parsed.quoted_original_html || '');
    const splitBody = quotedOriginalHtml && Object.prototype.hasOwnProperty.call(parsed, 'editor_body')
      ? {
          primaryHtml: String(parsed.editor_body || ''),
          quotedHtml: quotedOriginalHtml,
        }
      : splitQuotedHistoryHtml(parsed.body || '');

    return createComposeInitialState({
      composeMode: String(parsed.compose_mode || 'draft'),
      composeFromMailboxId: resolveMailboxId(parsed.from_mailbox_id || ''),
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      subject: String(parsed.subject || ''),
      composeBody: String(splitBody?.primaryHtml || ''),
      composeQuotedOriginalHtml: String(splitBody?.quotedHtml || ''),
      draftAttachments: Array.isArray(parsed.draft_attachments) ? parsed.draft_attachments : [],
      draftId: String(parsed.draft_id || ''),
      replyToMessageId: String(parsed.reply_to_message_id || ''),
      forwardMessageId: String(parsed.forward_message_id || ''),
      draftSyncState: 'local_only',
      draftSavedAt: String(parsed.saved_at || ''),
    });
  } catch {
    return null;
  }
};
