import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeComposeSubject } from './mailComposeSubject';
import {
  createComposeInitialState,
  isValidEmailRecipient,
  normalizeMailRecipient,
  readStoredComposeState,
} from './mailComposeState';
import { getMailPersonEmail } from './mailPeople';
import { splitQuotedHistoryHtml } from './mailQuotedHistory';
import { consumeMobileIncomingShare } from '../../lib/mobileIncomingShare';
import { plainTextToComposeHtml } from '../../lib/mailComposePrefill';

const getDefaultStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const clearStoredComposeDraft = (composeDraftKey, storage) => {
  try {
    storage?.removeItem?.(composeDraftKey);
  } catch {
    // ignore local storage issues
  }
};

export default function useMailComposeSessionController({
  composeDraftKey,
  resolveComposeMailboxId,
  selectedMessage = null,
  locationSearch = '',
  navigate,
  storage = getDefaultStorage(),
  consumeIncomingShare = consumeMobileIncomingShare,
} = {}) {
  const [composeSession, setComposeSession] = useState(null);
  const composeSessionCounterRef = useRef(0);
  const composeOpen = Boolean(composeSession);

  const openComposeSession = useCallback((initialState) => {
    composeSessionCounterRef.current += 1;
    setComposeSession({
      id: composeSessionCounterRef.current,
      initialState: createComposeInitialState(initialState),
    });
  }, []);

  const closeComposeSession = useCallback(() => {
    setComposeSession(null);
  }, []);

  const openCompose = useCallback(() => {
    const restoredState = readStoredComposeState({
      composeDraftKey,
      resolveComposeMailboxId,
      storage,
    });
    openComposeSession(
      restoredState || createComposeInitialState({
        composeMode: 'new',
        composeFromMailboxId: resolveComposeMailboxId(),
      })
    );
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId, storage]);

  useEffect(() => {
    const searchParams = new URLSearchParams(locationSearch || '');
    if (searchParams.get('compose') === 'android-share') {
      const share = consumeIncomingShare('mail');
      if (share) {
        openComposeSession({
          composeMode: 'new',
          composeFromMailboxId: resolveComposeMailboxId(),
          subject: share.subject,
          composeBody: plainTextToComposeHtml(share.text),
        });
      }
      searchParams.delete('compose');
      searchParams.delete('android_share_id');
      const nextQuery = searchParams.toString();
      navigate(nextQuery ? `/mail?${nextQuery}` : '/mail', { replace: true });
      return;
    }
    if (searchParams.get('compose') === 'new') {
      openCompose();
      searchParams.delete('compose');
      const nextQuery = searchParams.toString();
      navigate(nextQuery ? `/mail?${nextQuery}` : '/mail', { replace: true });
      return;
    }
    const composeTo = normalizeMailRecipient(searchParams.get('compose_to'));
    if (!composeTo || !isValidEmailRecipient(composeTo)) return;
    openComposeSession({
      composeMode: 'new',
      composeFromMailboxId: resolveComposeMailboxId(),
      to: [composeTo],
    });
    searchParams.delete('compose_to');
    const nextQuery = searchParams.toString();
    navigate(nextQuery ? `/mail?${nextQuery}` : '/mail', { replace: true });
  }, [consumeIncomingShare, locationSearch, navigate, openCompose, openComposeSession, resolveComposeMailboxId]);

  const openComposeFromMessage = useCallback((mode) => {
    if (!selectedMessage) return;
    const key = mode === 'reply_all' ? 'reply_all' : mode;
    const context = selectedMessage?.compose_context?.[key] || {};
    const quotedOriginalHtml = String(context?.quote_html || '');
    openComposeSession({
      composeMode: mode || 'reply',
      composeFromMailboxId: resolveComposeMailboxId(context?.mailbox_id || selectedMessage?.mailbox_id),
      to: context?.to,
      cc: context?.cc,
      bcc: [],
      subject: normalizeComposeSubject(mode, context?.subject || selectedMessage.subject || ''),
      composeBody: quotedOriginalHtml ? '<p><br></p>' : '',
      composeQuotedOriginalHtml: quotedOriginalHtml,
      replyToMessageId: mode === 'forward' ? '' : String(selectedMessage.id || ''),
      forwardMessageId: mode === 'forward' ? String(selectedMessage.id || '') : '',
      draftSyncState: 'idle',
      draftSavedAt: '',
    });
    clearStoredComposeDraft(composeDraftKey, storage);
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId, selectedMessage, storage]);

  const openComposeFromDraftMessage = useCallback((sourceMessage) => {
    if (!sourceMessage || String(sourceMessage.folder || '').toLowerCase() !== 'drafts') return;
    const draftContext = sourceMessage?.draft_context || {};
    const splitDraftBody = splitQuotedHistoryHtml(sourceMessage.body_html || '');
    openComposeSession({
      composeMode: String(draftContext.compose_mode || 'draft'),
      composeFromMailboxId: resolveComposeMailboxId(draftContext.mailbox_id || sourceMessage?.mailbox_id),
      to: sourceMessage.to,
      cc: sourceMessage.cc,
      bcc: sourceMessage.bcc,
      subject: String(sourceMessage.subject || ''),
      composeBody: String(splitDraftBody?.primaryHtml || ''),
      composeQuotedOriginalHtml: String(splitDraftBody?.quotedHtml || ''),
      draftAttachments: Array.isArray(sourceMessage.attachments) ? sourceMessage.attachments : [],
      draftId: String(sourceMessage.id || ''),
      replyToMessageId: String(draftContext.reply_to_message_id || ''),
      forwardMessageId: String(draftContext.forward_message_id || ''),
      draftSyncState: 'synced',
    });
    clearStoredComposeDraft(composeDraftKey, storage);
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId, storage]);

  const openComposeFromDraft = useCallback(() => {
    openComposeFromDraftMessage(selectedMessage);
  }, [openComposeFromDraftMessage, selectedMessage]);

  const openComposeToPerson = useCallback((person) => {
    const composeTo = normalizeMailRecipient(getMailPersonEmail(person));
    if (!composeTo || !isValidEmailRecipient(composeTo)) return;
    openComposeSession({
      composeMode: 'new',
      composeFromMailboxId: resolveComposeMailboxId(),
      to: [composeTo],
    });
  }, [openComposeSession, resolveComposeMailboxId]);

  return {
    composeSession,
    composeOpen,
    openCompose,
    openComposeFromMessage,
    openComposeFromDraftMessage,
    openComposeFromDraft,
    openComposeToPerson,
    closeComposeSession,
  };
}
