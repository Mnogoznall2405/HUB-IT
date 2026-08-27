import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { mailAPI } from '../../api/client';
import useDebounce from '../../hooks/useDebounce';
import {
  composeStateHasContent,
  createComposeInitialState,
  getComposeCombinedBody,
  getComposeDialogTitle,
  isValidEmailRecipient,
  parseComposeDraftSavedAtMs,
  readStoredComposeState,
  toRecipientEmails,
  writeStoredComposeState,
} from './mailComposeState';
import { createMailSendIdempotencyKey } from './mailSendIdempotency';
import { getMailSendErrorMessage } from './mailSendOutcome';
import { buildPortableComposeHtml } from './mailComposeHtml';

export const loadMailComposeDialog = () => import('./MailComposeDialog');
const MailComposeDialog = lazy(loadMailComposeDialog);

const normalizeMailboxId = (value) => String(value || '').trim();
const getMailboxEntryId = (value) => normalizeMailboxId(value?.id || value?.mailbox_id);
const normalizeContentId = (value) => String(value || '')
  .trim()
  .replace(/^cid:/i, '')
  .replace(/^<+|>+$/g, '')
  .toLowerCase();
const bodyReferencesContentId = (body, contentId) => String(body || '')
  .toLowerCase()
  .includes(`cid:${normalizeContentId(contentId)}`);
const getRetainedAttachmentTokens = (state) => (
  (Array.isArray(state?.composeDraftAttachments) ? state.composeDraftAttachments : [])
    .filter((item) => !item?.is_inline || bodyReferencesContentId(getComposeCombinedBody(state), item?.content_id))
    .map((item) => item?.download_token || item?.id)
    .filter(Boolean)
);
const getReferencedInlineFiles = (state) => (
  (Array.isArray(state?.composeInlineFiles) ? state.composeInlineFiles : [])
    .filter((item) => bodyReferencesContentId(getComposeCombinedBody(state), item?.contentId))
);
const getPortableComposeBody = (state) => buildPortableComposeHtml(getComposeCombinedBody(state));

export default function MailComposeHost({
  session,
  layoutMode,
  activeMailboxId,
  composeFromOptions,
  composeDraftKey,
  resolveComposeMailboxId,
  mailboxPrimaryDomain,
  mailboxSignatureHtml,
  signatureOpen,
  signatureHtml,
  signatureMailboxId,
  formatFullDate,
  formatFileSize,
  sumFilesSize,
  sumAttachmentSize,
  onOpenSignatureEditor,
  onCloseSession,
  onRegisterCloseHandler,
  onRegisterNativeSaveHandler,
  onSendSuccess,
  onDraftSaved,
  onComposeWarning,
  expanded,
  onToggleExpanded,
  onOpenDesktopWindow,
  handleMailCredentialsRequired,
  getMailErrorDetail,
}) {
  const [composeState, setComposeState] = useState(() => createComposeInitialState(session?.initialState));
  const [composeToSearch, setComposeToSearch] = useState('');
  const [composeToOptions, setComposeToOptions] = useState([]);
  const [composeToLoading, setComposeToLoading] = useState(false);
  const [closeDraftPromptOpen, setCloseDraftPromptOpen] = useState(false);
  const composeStateRef = useRef(composeState);
  const composeUploadAbortRef = useRef(null);
  const composeSendLockRef = useRef(false);
  const composeIdempotencyKeyRef = useRef('');
  const draftSaveInFlightRef = useRef(null);
  const draftSaveQueuedRef = useRef(false);
  const draftSaveIncludeFilesRef = useRef(false);
  const draftSaveForceCreateRef = useRef(false);
  const notifiedComposeWarningsRef = useRef(new Set());
  const mountedRef = useRef(true);
  const lastWrittenSavedAtRef = useRef('');
  const localDraftDirtyRef = useRef(false);
  const pendingAfterCloseRef = useRef(null);
  const composeFlushHandlerRef = useRef(null);
  const closeFlowLockRef = useRef(false);
  const inlinePreviewUrlsRef = useRef(new Set());
  const debouncedComposeToSearch = useDebounce(composeToSearch, 400);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (composeUploadAbortRef.current) {
        composeUploadAbortRef.current.abort();
        composeUploadAbortRef.current = null;
      }
      inlinePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL?.(url));
      inlinePreviewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    composeStateRef.current = composeState;
  }, [composeState]);

  useEffect(() => {
    const nextState = createComposeInitialState(session?.initialState);
    if (composeUploadAbortRef.current) {
      composeUploadAbortRef.current.abort();
      composeUploadAbortRef.current = null;
    }
    setComposeState(nextState);
    setComposeToSearch('');
    composeIdempotencyKeyRef.current = '';
    setComposeToOptions([]);
    setComposeToLoading(false);
    setCloseDraftPromptOpen(false);
    pendingAfterCloseRef.current = null;
    closeFlowLockRef.current = false;
    notifiedComposeWarningsRef.current = new Set();
    lastWrittenSavedAtRef.current = String(nextState.draftSavedAt || '');
    localDraftDirtyRef.current = false;
  }, [session?.id]);

  const patchComposeState = useCallback((updater, { markDirty = true } = {}) => {
    if (!mountedRef.current) return;
    setComposeState((prev) => {
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      if (!patch || typeof patch !== 'object') return prev;
      if (markDirty) localDraftDirtyRef.current = true;
      return { ...prev, ...patch };
    });
  }, []);

  useEffect(() => {
    if (composeFromOptions.length === 0) return;
    patchComposeState((current) => {
      const normalizedCurrent = normalizeMailboxId(current.composeFromMailboxId);
      if (normalizedCurrent && composeFromOptions.some((item) => getMailboxEntryId(item) === normalizedCurrent)) {
        return null;
      }
      return {
        composeFromMailboxId: normalizeMailboxId(activeMailboxId || getMailboxEntryId(composeFromOptions[0])),
      };
    });
  }, [activeMailboxId, composeFromOptions, patchComposeState]);

  useEffect(() => {
    const query = String(debouncedComposeToSearch || '').trim();
    if (query.length < 2) {
      setComposeToOptions([]);
      return;
    }
    let active = true;
    setComposeToLoading(true);
    mailAPI.searchContacts(query, { mailboxId: activeMailboxId })
      .then((items) => {
        if (active) setComposeToOptions(Array.isArray(items) ? items : []);
      })
      .finally(() => {
        if (active) setComposeToLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeMailboxId, debouncedComposeToSearch]);

  useEffect(() => {
    const fieldErrors = composeState.composeFieldErrors || {};
    if (!fieldErrors.to && !fieldErrors.cc && !fieldErrors.bcc) return;
    const to = toRecipientEmails(composeState.composeToValues);
    const cc = toRecipientEmails(composeState.composeCcValues);
    const bcc = toRecipientEmails(composeState.composeBccValues);
    const nextErrors = { ...fieldErrors };
    let changed = false;
    if (nextErrors.to && to.length > 0 && to.every((value) => isValidEmailRecipient(value))) {
      delete nextErrors.to;
      changed = true;
    }
    if (nextErrors.cc && cc.every((value) => isValidEmailRecipient(value))) {
      delete nextErrors.cc;
      changed = true;
    }
    if (nextErrors.bcc && bcc.every((value) => isValidEmailRecipient(value))) {
      delete nextErrors.bcc;
      changed = true;
    }
    if (changed) {
      patchComposeState({ composeFieldErrors: nextErrors });
    }
  }, [
    composeState.composeBccValues,
    composeState.composeCcValues,
    composeState.composeFieldErrors,
    composeState.composeToValues,
    patchComposeState,
  ]);

  const hasComposeContent = useMemo(
    () => composeStateHasContent(composeState),
    [
      composeState.composeBccValues,
      composeState.composeBody,
      composeState.composeCcValues,
      composeState.composeDraftAttachments,
      composeState.composeFiles,
      composeState.composeInlineFiles,
      composeState.composeQuotedOriginalHtml,
      composeState.composeSubject,
      composeState.composeToValues,
    ],
  );

  const composeAutosaveKey = useMemo(() => JSON.stringify({
    composeMode: composeState.composeMode,
    fromMailboxId: resolveComposeMailboxId(composeState.composeFromMailboxId),
    to: toRecipientEmails(composeState.composeToValues),
    cc: toRecipientEmails(composeState.composeCcValues),
    bcc: toRecipientEmails(composeState.composeBccValues),
    subject: String(composeState.composeSubject || ''),
    body: String(getComposeCombinedBody(composeState) || ''),
    replyToMessageId: String(composeState.composeReplyToMessageId || ''),
    forwardMessageId: String(composeState.composeForwardMessageId || ''),
    retainedAttachments: getRetainedAttachmentTokens(composeState),
    inlineContentIds: composeState.composeInlineFiles.map((item) => item?.contentId).filter(Boolean),
  }), [
    composeState.composeBccValues,
    composeState.composeBody,
    composeState.composeCcValues,
    composeState.composeDraftAttachments,
    composeState.composeForwardMessageId,
    composeState.composeFromMailboxId,
    composeState.composeMode,
    composeState.composeInlineFiles,
    composeState.composeQuotedOriginalHtml,
    composeState.composeReplyToMessageId,
    composeState.composeSubject,
    composeState.composeToValues,
    resolveComposeMailboxId,
  ]);

  const composeSignaturePreviewHtml = useMemo(() => {
    const composeMailboxId = resolveComposeMailboxId(composeState.composeFromMailboxId || activeMailboxId);
    const editingMailboxId = resolveComposeMailboxId(signatureMailboxId || composeState.composeFromMailboxId || activeMailboxId);
    if (signatureOpen && composeMailboxId && composeMailboxId === editingMailboxId) {
      return String(signatureHtml || '');
    }
    return String(mailboxSignatureHtml || '');
  }, [
    activeMailboxId,
    composeState.composeFromMailboxId,
    mailboxSignatureHtml,
    resolveComposeMailboxId,
    signatureHtml,
    signatureMailboxId,
    signatureOpen,
  ]);

  const inlineSourcesByCid = useMemo(() => {
    const sources = {};
    composeState.composeDraftAttachments.forEach((attachment) => {
      if (!attachment?.is_inline) return;
      const contentId = normalizeContentId(attachment?.content_id);
      const source = String(attachment?.inline_src || attachment?.inline_data_url || '');
      if (contentId && source) sources[contentId] = source;
    });
    composeState.composeInlineFiles.forEach((item) => {
      const contentId = normalizeContentId(item?.contentId);
      if (contentId && item?.previewUrl) sources[contentId] = item.previewUrl;
    });
    return sources;
  }, [composeState.composeDraftAttachments, composeState.composeInlineFiles]);

  const handlePasteInlineImages = useCallback((files) => {
    const descriptors = (Array.isArray(files) ? files : Array.from(files || [])).map((file) => {
      const uniquePart = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contentId = `hubit-inline-${uniquePart}@hubit.local`;
      const previewUrl = URL.createObjectURL?.(file) || '';
      if (previewUrl) inlinePreviewUrlsRef.current.add(previewUrl);
      return { file, contentId, previewUrl };
    }).filter((item) => item.previewUrl);
    if (descriptors.length > 0) {
      patchComposeState((current) => ({
        composeInlineFiles: [...current.composeInlineFiles, ...descriptors],
      }));
    }
    return descriptors;
  }, [patchComposeState]);

  const composeWarnings = useMemo(() => {
    const recipientValues = [
      ...toRecipientEmails(composeState.composeToValues),
      ...toRecipientEmails(composeState.composeCcValues),
      ...toRecipientEmails(composeState.composeBccValues),
    ];
    const warnings = [];
    if (!String(composeState.composeSubject || '').trim()) {
      warnings.push({
        id: 'empty_subject',
        severity: 'warning',
        title: 'Письмо без темы',
        message: 'Тема письма пустая.',
        notifyOnAppear: false,
      });
    }
    if (mailboxPrimaryDomain) {
      const hasExternal = recipientValues.some((email) => {
        const domain = String(email.split('@')[1] || '').trim().toLowerCase();
        return domain && domain !== mailboxPrimaryDomain;
      });
      if (hasExternal) {
        warnings.push({
          id: 'external_recipients',
          severity: 'info',
          title: 'Внешний адресат',
          message: 'В письме есть внешние получатели.',
        });
      }
    }
    const plainBody = String(composeState.composeBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const attachmentMentioned = /(влож|прикреп|attach|attachment|файл)/i.test(plainBody);
    const regularDraftAttachmentCount = composeState.composeDraftAttachments.filter((item) => !item?.is_inline).length;
    if (attachmentMentioned && composeState.composeFiles.length === 0 && regularDraftAttachmentCount === 0) {
      warnings.push({
        id: 'missing_attachment',
        severity: 'warning',
        title: 'Проверьте вложение',
        message: 'В тексте упомянуто вложение, но файлы не прикреплены.',
      });
    }
    return warnings.filter((item) => !composeState.dismissedComposeWarnings.includes(item.id));
  }, [
    composeState.composeBccValues,
    composeState.composeBody,
    composeState.composeCcValues,
    composeState.composeDraftAttachments,
    composeState.composeFiles,
    composeState.composeSubject,
    composeState.composeToValues,
    composeState.dismissedComposeWarnings,
    mailboxPrimaryDomain,
  ]);

  const notifyComposeWarning = useCallback((warning, options = {}) => {
    if (!warning || typeof onComposeWarning !== 'function') return;
    const warningId = String(warning.id || 'compose-warning');
    onComposeWarning({
      ...warning,
      ...options,
      id: warningId,
      source: 'mail-compose',
      dedupeKey: options.dedupeKey || `mail-compose:${session?.id || 'active'}:${warningId}`,
    });
  }, [onComposeWarning, session?.id]);

  useEffect(() => {
    composeWarnings.forEach((warning) => {
      if (warning?.notifyOnAppear === false) return;
      const key = `${warning?.id || ''}:${warning?.message || ''}`;
      if (!key || notifiedComposeWarningsRef.current.has(key)) return;
      notifiedComposeWarningsRef.current.add(key);
      notifyComposeWarning(warning);
    });
  }, [composeWarnings, notifyComposeWarning]);

  const clearStoredComposeDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
    lastWrittenSavedAtRef.current = '';
    localDraftDirtyRef.current = false;
  }, [composeDraftKey]);

  const persistLocalComposeDraft = useCallback((stateOverride = composeStateRef.current) => {
    if (typeof window === 'undefined') return;
    const state = stateOverride || composeStateRef.current;
    const payload = {
      compose_mode: state.composeMode || 'draft',
      from_mailbox_id: resolveComposeMailboxId(state.composeFromMailboxId),
      to: toRecipientEmails(state.composeToValues),
      cc: toRecipientEmails(state.composeCcValues),
      bcc: toRecipientEmails(state.composeBccValues),
      subject: String(state.composeSubject || ''),
      body: String(getComposeCombinedBody(state) || ''),
      editor_body: String(state.composeBody || ''),
      quoted_original_html: String(state.composeQuotedOriginalHtml || ''),
      draft_id: String(state.composeDraftId || ''),
      reply_to_message_id: String(state.composeReplyToMessageId || ''),
      forward_message_id: String(state.composeForwardMessageId || ''),
      draft_attachments: Array.isArray(state.composeDraftAttachments) ? state.composeDraftAttachments : [],
      local_attachment_names: (Array.isArray(state.composeFiles) ? state.composeFiles : []).map((file) => String(file?.name || '')).filter(Boolean),
    };
    const result = writeStoredComposeState({
      composeDraftKey,
      payload,
      lastWrittenSavedAt: lastWrittenSavedAtRef.current,
      localDirty: localDraftDirtyRef.current,
    });
    if (result.wrote) {
      lastWrittenSavedAtRef.current = result.savedAt;
      localDraftDirtyRef.current = false;
      return;
    }
    if (!result.adoptedRaw) return;
    const adopted = readStoredComposeState({
      composeDraftKey,
      resolveComposeMailboxId,
    });
    if (!adopted) return;
    lastWrittenSavedAtRef.current = adopted.draftSavedAt;
    localDraftDirtyRef.current = false;
    patchComposeState(adopted, { markDirty: false });
  }, [composeDraftKey, patchComposeState, resolveComposeMailboxId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (event) => {
      if (event.key !== composeDraftKey) return;
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (localDraftDirtyRef.current) return;
      const adopted = readStoredComposeState({
        composeDraftKey,
        resolveComposeMailboxId,
      });
      if (!adopted) return;
      const remoteMs = parseComposeDraftSavedAtMs(adopted.draftSavedAt);
      const lastMs = parseComposeDraftSavedAtMs(lastWrittenSavedAtRef.current);
      if (remoteMs <= lastMs) return;
      lastWrittenSavedAtRef.current = adopted.draftSavedAt;
      patchComposeState(adopted, { markDirty: false });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [composeDraftKey, patchComposeState, resolveComposeMailboxId]);

  const flushComposeDraft = useCallback(({ includeFiles = false, forceCreate = false } = {}) => {
    draftSaveQueuedRef.current = true;
    if (includeFiles) draftSaveIncludeFilesRef.current = true;
    if (forceCreate) draftSaveForceCreateRef.current = true;
    if (draftSaveInFlightRef.current) return draftSaveInFlightRef.current;

    const drainDraftSaveQueue = async () => {
      let lastResult = null;
      while (draftSaveQueuedRef.current) {
        const shouldIncludeFiles = draftSaveIncludeFilesRef.current;
        const shouldForceCreate = draftSaveForceCreateRef.current;
        draftSaveQueuedRef.current = false;
        draftSaveIncludeFilesRef.current = false;
        draftSaveForceCreateRef.current = false;
        const state = composeStateRef.current;
        if (!shouldForceCreate && !composeStateHasContent(state) && !state.composeDraftId) continue;
        const referencedInlineFiles = shouldIncludeFiles ? getReferencedInlineFiles(state) : [];

        patchComposeState({ draftSyncState: 'saving' });
        try {
          const data = await mailAPI.saveDraftMultipart({
            fromMailboxId: resolveComposeMailboxId(state.composeFromMailboxId),
            draftId: state.composeDraftId,
            composeMode: state.composeMode,
            to: toRecipientEmails(state.composeToValues),
            cc: toRecipientEmails(state.composeCcValues),
            bcc: toRecipientEmails(state.composeBccValues),
            subject: String(state.composeSubject || ''),
            body: getPortableComposeBody(state),
            isHtml: true,
            replyToMessageId: state.composeReplyToMessageId,
            forwardMessageId: state.composeForwardMessageId,
            retainExistingAttachments: getRetainedAttachmentTokens(state),
            files: shouldIncludeFiles ? state.composeFiles : [],
            inlineFiles: referencedInlineFiles.map((item) => item.file),
            inlineContentIds: referencedInlineFiles.map((item) => item.contentId),
          });
          patchComposeState((current) => ({
            composeDraftId: String(data?.draft_id || current.composeDraftId || ''),
            composeDraftAttachments: Array.isArray(data?.attachments) ? data.attachments : current.composeDraftAttachments,
            composeFiles: shouldIncludeFiles && current.composeFiles.length > 0 ? [] : current.composeFiles,
            composeInlineFiles: shouldIncludeFiles ? [] : current.composeInlineFiles,
            draftSavedAt: String(data?.saved_at || new Date().toISOString()),
            draftSyncState: 'synced',
          }));
          clearStoredComposeDraft();
          lastResult = data;
        } catch (requestError) {
          draftSaveQueuedRef.current = false;
          draftSaveIncludeFilesRef.current = false;
          draftSaveForceCreateRef.current = false;
          persistLocalComposeDraft(composeStateRef.current);
          patchComposeState({ draftSyncState: 'local_only' });
          throw requestError;
        }
      }
      return lastResult;
    };

    const pending = drainDraftSaveQueue().finally(() => {
      if (draftSaveInFlightRef.current === pending) {
        draftSaveInFlightRef.current = null;
      }
    });
    draftSaveInFlightRef.current = pending;
    return pending;
  }, [clearStoredComposeDraft, patchComposeState, persistLocalComposeDraft, resolveComposeMailboxId]);

  const discardComposeDraft = useCallback(async (state) => {
    if (state?.composeDraftId) {
      try {
        await mailAPI.deleteDraft(state.composeDraftId, { mailboxId: resolveComposeMailboxId(state.composeFromMailboxId) });
      } catch {
        // ignore draft cleanup errors
      }
    }
    clearStoredComposeDraft();
  }, [clearStoredComposeDraft, resolveComposeMailboxId]);

  useEffect(() => {
    if (composeState.composeSending || (!hasComposeContent && !composeState.composeDraftId)) return undefined;
    const timer = setTimeout(() => {
      flushComposeDraft({ includeFiles: composeState.composeInlineFiles.length > 0 }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [composeAutosaveKey, composeState.composeInlineFiles.length, composeState.composeSending, flushComposeDraft, hasComposeContent]);

  const finishCloseCompose = useCallback(() => {
    const afterClose = pendingAfterCloseRef.current;
    pendingAfterCloseRef.current = null;
    setCloseDraftPromptOpen(false);
    onCloseSession?.();
    if (typeof afterClose === 'function') {
      afterClose();
    }
  }, [onCloseSession]);

  const handleKeepEditingCompose = useCallback(() => {
    pendingAfterCloseRef.current = null;
    setCloseDraftPromptOpen(false);
  }, []);

  const flushPendingComposeState = useCallback(() => {
    const flushed = composeFlushHandlerRef.current?.();
    if (!flushed || typeof flushed !== 'object') return;
    composeStateRef.current = {
      ...composeStateRef.current,
      ...flushed,
    };
    patchComposeState(flushed);
  }, [patchComposeState]);

  const notifyDraftSaved = useCallback(async () => {
    try {
      await onDraftSaved?.();
    } catch {
      // cache refresh is best-effort after a successful Exchange save
    }
  }, [onDraftSaved]);

  const handleCloseCompose = useCallback(async (options) => {
    if (composeStateRef.current.composeSending) return;
    const switchingAway = Boolean(
      options && typeof options === 'object' && typeof options.afterClose === 'function',
    );
    if (switchingAway) {
      pendingAfterCloseRef.current = options.afterClose;
    }
    if (closeFlowLockRef.current) return;

    flushPendingComposeState();
    const state = composeStateRef.current;
    if (!composeStateHasContent(state) && state.composeDraftId) {
      await discardComposeDraft(state);
      finishCloseCompose();
      return;
    }
    if (!composeStateHasContent(state)) {
      finishCloseCompose();
      return;
    }
    if (switchingAway) {
      closeFlowLockRef.current = true;
      try {
        await flushComposeDraft({ includeFiles: true });
        await notifyDraftSaved();
        finishCloseCompose();
      } catch (requestError) {
        pendingAfterCloseRef.current = null;
        onComposeWarning?.({
          id: 'draft_save_failed',
          severity: 'warning',
          title: 'Черновик не сохранён',
          message: getMailErrorDetail?.(
            requestError,
            'Не удалось сохранить письмо в черновики. Композер оставлен открытым.',
          ) || 'Не удалось сохранить письмо в черновики. Композер оставлен открытым.',
        });
      } finally {
        closeFlowLockRef.current = false;
      }
      return;
    }
    setCloseDraftPromptOpen(true);
  }, [
    discardComposeDraft,
    finishCloseCompose,
    flushComposeDraft,
    flushPendingComposeState,
    getMailErrorDetail,
    notifyDraftSaved,
    onComposeWarning,
  ]);

  const handleSaveAndCloseCompose = useCallback(async () => {
    setCloseDraftPromptOpen(false);
    try {
      await flushComposeDraft({ includeFiles: true });
      await notifyDraftSaved();
    } catch {
      onComposeWarning?.({
        id: 'draft_local_only',
        severity: 'info',
        title: 'Черновик',
        message: 'Черновик сохранён локально. В папке «Черновики» его может не быть, пока нет связи с почтой.',
      });
    }
    finishCloseCompose();
  }, [finishCloseCompose, flushComposeDraft, notifyDraftSaved, onComposeWarning]);

  const handleDiscardAndCloseCompose = useCallback(async () => {
    setCloseDraftPromptOpen(false);
    await discardComposeDraft(composeStateRef.current);
    finishCloseCompose();
  }, [discardComposeDraft, finishCloseCompose]);

  const handleCloseComposeRef = useRef(handleCloseCompose);
  handleCloseComposeRef.current = handleCloseCompose;

  useEffect(() => {
    if (!onRegisterCloseHandler) return undefined;
    onRegisterCloseHandler((options) => handleCloseComposeRef.current(options));
    return () => onRegisterCloseHandler(null);
  }, [onRegisterCloseHandler]);

  useEffect(() => {
    if (!onRegisterNativeSaveHandler) return undefined;
    onRegisterNativeSaveHandler(async () => {
      flushPendingComposeState();
      try {
        await flushComposeDraft({ includeFiles: true });
        await notifyDraftSaved();
        return true;
      } catch (requestError) {
        onComposeWarning?.({
          id: 'desktop_compose_close_save_failed',
          severity: 'warning',
          title: 'Черновик не сохранён',
          message: getMailErrorDetail?.(requestError, 'Не удалось сохранить черновик. Окно оставлено открытым.'),
        });
        return false;
      }
    });
    return () => onRegisterNativeSaveHandler(null);
  }, [
    flushComposeDraft,
    flushPendingComposeState,
    getMailErrorDetail,
    notifyDraftSaved,
    onComposeWarning,
    onRegisterNativeSaveHandler,
  ]);

  const handleSendCompose = useCallback(async (submitOverrides = {}) => {
    const recipientOverrides = {};
    if (Array.isArray(submitOverrides?.composeToValues)) {
      recipientOverrides.composeToValues = submitOverrides.composeToValues;
    }
    if (Array.isArray(submitOverrides?.composeCcValues)) {
      recipientOverrides.composeCcValues = submitOverrides.composeCcValues;
    }
    if (Array.isArray(submitOverrides?.composeBccValues)) {
      recipientOverrides.composeBccValues = submitOverrides.composeBccValues;
    }
    if (Object.keys(recipientOverrides).length > 0) {
      composeStateRef.current = {
        ...composeStateRef.current,
        ...recipientOverrides,
      };
      patchComposeState(recipientOverrides);
    }
    const state = composeStateRef.current;
    const to = toRecipientEmails(state.composeToValues);
    const cc = toRecipientEmails(state.composeCcValues);
    const bcc = toRecipientEmails(state.composeBccValues);
    const validationErrors = {};
    if (to.length === 0) validationErrors.to = 'Укажите хотя бы одного получателя.';
    if (to.some((value) => !isValidEmailRecipient(value))) validationErrors.to = 'Проверьте адреса в поле "Кому".';
    if (cc.some((value) => !isValidEmailRecipient(value))) validationErrors.cc = 'Проверьте адреса в поле "Копия".';
    if (bcc.some((value) => !isValidEmailRecipient(value))) validationErrors.bcc = 'Проверьте адреса в поле "Скрытая копия".';
    if (Object.keys(validationErrors).length > 0) {
      patchComposeState({ composeFieldErrors: validationErrors });
      return;
    }
    if (!String(state.composeSubject || '').trim()) {
      notifyComposeWarning({
        id: 'empty_subject_send',
        severity: 'warning',
        title: 'Письмо без темы',
        message: 'Тема письма пустая. Письмо будет отправлено без темы.',
      });
    }
    if (composeSendLockRef.current) return;
    composeSendLockRef.current = true;
    if (!composeIdempotencyKeyRef.current) {
      composeIdempotencyKeyRef.current = createMailSendIdempotencyKey();
    }
    const idempotencyKey = composeIdempotencyKeyRef.current;
    patchComposeState({
      composeFieldErrors: {},
      composeError: '',
      composeSending: true,
      composeUploadProgress: 0,
    });
    try {
      const referencedInlineFiles = getReferencedInlineFiles(state);
      if (state.composeFiles.length > 0 || referencedInlineFiles.length > 0) {
        const controller = new AbortController();
        composeUploadAbortRef.current = controller;
        await mailAPI.sendMessageMultipart({
          fromMailboxId: resolveComposeMailboxId(state.composeFromMailboxId),
          to,
          cc,
          bcc,
          subject: String(state.composeSubject || ''),
          body: getPortableComposeBody(state),
          isHtml: true,
          replyToMessageId: state.composeReplyToMessageId,
          forwardMessageId: state.composeForwardMessageId,
          draftId: state.composeDraftId,
          retainExistingAttachments: getRetainedAttachmentTokens(state),
          files: state.composeFiles,
          inlineFiles: referencedInlineFiles.map((item) => item.file),
          inlineContentIds: referencedInlineFiles.map((item) => item.contentId),
          idempotencyKey,
          signal: controller.signal,
          onUploadProgress: (event) => {
            const total = Number(event?.total || 0);
            const loaded = Number(event?.loaded || 0);
            if (total <= 0) return;
            const nextProgress = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
            patchComposeState((current) => (
              current.composeUploadProgress === nextProgress
                ? null
                : { composeUploadProgress: nextProgress }
            ));
          },
        });
      } else {
        await mailAPI.sendMessage({
          from_mailbox_id: resolveComposeMailboxId(state.composeFromMailboxId),
          to,
          cc,
          bcc,
          subject: String(state.composeSubject || ''),
          body: getPortableComposeBody(state),
          is_html: true,
          reply_to_message_id: state.composeReplyToMessageId,
          forward_message_id: state.composeForwardMessageId,
          draft_id: state.composeDraftId,
          retain_existing_attachments: getRetainedAttachmentTokens(state),
          idempotencyKey,
        });
      }
      composeIdempotencyKeyRef.current = '';
      clearStoredComposeDraft();
      await onSendSuccess?.();
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError, 'Не удалось отправить письмо.')) {
        patchComposeState({ composeError: '' });
      } else {
        patchComposeState({
          composeError: getMailSendErrorMessage(requestError, 'Не удалось отправить письмо.'),
        });
      }
    } finally {
      composeSendLockRef.current = false;
      composeUploadAbortRef.current = null;
      patchComposeState({
        composeUploadProgress: 0,
        composeSending: false,
      });
    }
  }, [
    clearStoredComposeDraft,
    handleMailCredentialsRequired,
    notifyComposeWarning,
    onSendSuccess,
    patchComposeState,
    resolveComposeMailboxId,
  ]);

  const handleOpenDesktopCompose = useCallback(async () => {
    if (!onOpenDesktopWindow) return;
    flushPendingComposeState();
    try {
      const data = await flushComposeDraft({ includeFiles: true, forceCreate: true });
      const draftId = String(data?.draft_id || composeStateRef.current.composeDraftId || '');
      if (!draftId) throw new Error('Draft id is missing after save');
      await onOpenDesktopWindow({
        draftId,
        mailboxId: resolveComposeMailboxId(composeStateRef.current.composeFromMailboxId),
      });
    } catch (requestError) {
      onComposeWarning?.({
        id: 'desktop_compose_transfer_failed',
        severity: 'warning',
        title: 'Не удалось открыть отдельное окно',
        message: getMailErrorDetail?.(
          requestError,
          'Черновик не удалось сохранить. Редактор оставлен в текущем окне.',
        ),
      });
    }
  }, [
    flushComposeDraft,
    flushPendingComposeState,
    getMailErrorDetail,
    onComposeWarning,
    onOpenDesktopWindow,
    resolveComposeMailboxId,
  ]);

  return (
    <>
      <MailComposeDialog
        open
        onClose={handleCloseCompose}
        dialogTitle={getComposeDialogTitle(composeState.composeMode)}
        composeMode={composeState.composeMode}
        draftSyncState={composeState.draftSyncState}
        draftSavedAt={composeState.draftSavedAt}
        composeError={composeState.composeError}
        onClearComposeError={() => patchComposeState({ composeError: '' })}
        formatFullDate={formatFullDate}
        composeDragActive={composeState.composeDragActive}
        onDragEnter={(event) => {
          event.preventDefault();
          patchComposeState({ composeDragActive: true });
        }}
        onDragOver={(event) => {
          event.preventDefault();
          patchComposeState({ composeDragActive: true });
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          patchComposeState({ composeDragActive: false });
        }}
        onDrop={(event) => {
          event.preventDefault();
          patchComposeState((current) => ({
            composeDragActive: false,
            composeFiles: Array.from(event.dataTransfer?.files || []).length > 0
              ? [...current.composeFiles, ...Array.from(event.dataTransfer?.files || [])]
              : current.composeFiles,
          }));
        }}
        onFileChange={(event) => {
          const files = Array.from(event.target.files || []);
          patchComposeState((current) => ({
            composeFiles: files.length > 0 ? [...current.composeFiles, ...files] : current.composeFiles,
          }));
          event.target.value = '';
        }}
        composeToOptions={composeToOptions}
        composeToLoading={composeToLoading}
        composeFromOptions={composeFromOptions}
        composeFromMailboxId={composeState.composeFromMailboxId}
        onComposeFromMailboxIdChange={(value) => patchComposeState({ composeFromMailboxId: String(value || '') })}
        composeToValues={composeState.composeToValues}
        onComposeToValuesChange={(value) => patchComposeState({ composeToValues: Array.isArray(value) ? value : [] })}
        onComposeToSearchChange={setComposeToSearch}
        composeFieldErrors={composeState.composeFieldErrors}
        composeCcValues={composeState.composeCcValues}
        onComposeCcValuesChange={(value) => patchComposeState({ composeCcValues: Array.isArray(value) ? value : [] })}
        composeBccValues={composeState.composeBccValues}
        onComposeBccValuesChange={(value) => patchComposeState({ composeBccValues: Array.isArray(value) ? value : [] })}
        composeSubject={composeState.composeSubject}
        onComposeSubjectChange={(value) => patchComposeState({ composeSubject: String(value || '') })}
        composeBody={composeState.composeBody}
        onComposeBodyChange={(value) => patchComposeState({ composeBody: String(value || '') })}
        quotedOriginalHtml={composeState.composeQuotedOriginalHtml}
        composeSignatureHtml={composeSignaturePreviewHtml}
        composeDraftAttachments={composeState.composeDraftAttachments}
        composeFiles={composeState.composeFiles}
        inlineSourcesByCid={inlineSourcesByCid}
        onPasteInlineImages={handlePasteInlineImages}
        onSendComposeShortcut={handleSendCompose}
        formatFileSize={formatFileSize}
        sumFilesSize={sumFilesSize}
        sumAttachmentSize={sumAttachmentSize}
        onRemoveDraftAttachment={(id) => patchComposeState((current) => ({
          composeDraftAttachments: current.composeDraftAttachments.filter((item) => String(item.id) !== String(id)),
        }))}
        onRemoveComposeFile={(indexToRemove) => patchComposeState((current) => ({
          composeFiles: current.composeFiles.filter((_, index) => index !== indexToRemove),
        }))}
        composeSending={composeState.composeSending}
        composeUploadProgress={composeState.composeUploadProgress}
        onCancelComposeUpload={() => {
          if (composeUploadAbortRef.current) composeUploadAbortRef.current.abort();
        }}
        onOpenSignatureEditor={() => onOpenSignatureEditor?.(composeState.composeFromMailboxId)}
        onSendCompose={handleSendCompose}
        onRegisterFlushHandler={(handler) => { composeFlushHandlerRef.current = handler; }}
        desktopFullScreen={Boolean(expanded)}
        onToggleExpanded={onToggleExpanded}
        onOpenDesktopWindow={onOpenDesktopWindow ? handleOpenDesktopCompose : undefined}
        layoutMode={layoutMode}
      />
      <Dialog open={closeDraftPromptOpen} onClose={handleKeepEditingCompose} maxWidth="xs" fullWidth>
        <DialogTitle>Сохранить письмо в черновики?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Если не сохранить, изменения в этом письме будут удалены.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleKeepEditingCompose} sx={{ textTransform: 'none' }}>
            Продолжить редактирование
          </Button>
          <Button color="error" onClick={handleDiscardAndCloseCompose} sx={{ textTransform: 'none' }}>
            Не сохранять
          </Button>
          <Button variant="contained" onClick={handleSaveAndCloseCompose} sx={{ textTransform: 'none' }}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
