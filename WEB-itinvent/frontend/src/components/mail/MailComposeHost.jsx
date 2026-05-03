import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mailAPI } from '../../api/client';
import useDebounce from '../../hooks/useDebounce';
import {
  composeStateHasContent,
  createComposeInitialState,
  getComposeCombinedBody,
  getComposeDialogTitle,
  toRecipientEmails,
} from './mailComposeState';

export const loadMailComposeDialog = () => import('./MailComposeDialog');
const MailComposeDialog = lazy(loadMailComposeDialog);

const normalizeMailboxId = (value) => String(value || '').trim();
const getMailboxEntryId = (value) => normalizeMailboxId(value?.id || value?.mailbox_id);
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+$/.test(String(value || '').trim());

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
  onSendSuccess,
  handleMailCredentialsRequired,
  getMailErrorDetail,
}) {
  const [composeState, setComposeState] = useState(() => createComposeInitialState(session?.initialState));
  const [composeToSearch, setComposeToSearch] = useState('');
  const [composeToOptions, setComposeToOptions] = useState([]);
  const [composeToLoading, setComposeToLoading] = useState(false);
  const composeStateRef = useRef(composeState);
  const composeUploadAbortRef = useRef(null);
  const mountedRef = useRef(true);
  const debouncedComposeToSearch = useDebounce(composeToSearch, 400);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (composeUploadAbortRef.current) {
        composeUploadAbortRef.current.abort();
        composeUploadAbortRef.current = null;
      }
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
    setComposeToOptions([]);
    setComposeToLoading(false);
  }, [session?.id]);

  const patchComposeState = useCallback((updater) => {
    if (!mountedRef.current) return;
    setComposeState((prev) => {
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      if (!patch || typeof patch !== 'object') return prev;
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
    if (nextErrors.to && to.length > 0 && to.every((value) => isValidEmail(value))) {
      delete nextErrors.to;
      changed = true;
    }
    if (nextErrors.cc && cc.every((value) => isValidEmail(value))) {
      delete nextErrors.cc;
      changed = true;
    }
    if (nextErrors.bcc && bcc.every((value) => isValidEmail(value))) {
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
      composeState.composeQuotedOriginalHtml,
      composeState.composeSubject,
      composeState.composeToValues,
    ],
  );

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
        message: 'Тема письма пустая.',
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
          message: 'В письме есть внешние получатели.',
        });
      }
    }
    const plainBody = String(composeState.composeBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const attachmentMentioned = /(влож|прикреп|attach|attachment|файл)/i.test(plainBody);
    if (attachmentMentioned && composeState.composeFiles.length === 0 && composeState.composeDraftAttachments.length === 0) {
      warnings.push({
        id: 'missing_attachment',
        severity: 'warning',
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

  const clearStoredComposeDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
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
      saved_at: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(composeDraftKey, JSON.stringify(payload));
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey, resolveComposeMailboxId]);

  const flushComposeDraft = useCallback(async ({ includeFiles = false } = {}) => {
    const state = composeStateRef.current;
    if (!composeStateHasContent(state) && !state.composeDraftId) return null;
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
        body: String(getComposeCombinedBody(state) || ''),
        isHtml: true,
        replyToMessageId: state.composeReplyToMessageId,
        forwardMessageId: state.composeForwardMessageId,
        retainExistingAttachments: state.composeDraftAttachments.map((item) => item?.download_token || item?.id).filter(Boolean),
        files: includeFiles ? state.composeFiles : [],
      });
      patchComposeState((current) => ({
        composeDraftId: String(data?.draft_id || current.composeDraftId || ''),
        composeDraftAttachments: Array.isArray(data?.attachments) ? data.attachments : current.composeDraftAttachments,
        composeFiles: includeFiles && current.composeFiles.length > 0 ? [] : current.composeFiles,
        draftSavedAt: String(data?.saved_at || new Date().toISOString()),
        draftSyncState: 'synced',
      }));
      clearStoredComposeDraft();
      return data;
    } catch (requestError) {
      persistLocalComposeDraft(state);
      patchComposeState({ draftSyncState: 'local_only' });
      throw requestError;
    }
  }, [clearStoredComposeDraft, patchComposeState, persistLocalComposeDraft, resolveComposeMailboxId]);

  useEffect(() => {
    if (composeState.composeSending || (!hasComposeContent && !composeState.composeDraftId)) return undefined;
    const timer = setTimeout(() => {
      flushComposeDraft({ includeFiles: false }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [composeState, flushComposeDraft, hasComposeContent]);

  const handleCloseCompose = useCallback(async () => {
    const state = composeStateRef.current;
    if (state.composeSending) return;
    if (!composeStateHasContent(state) && state.composeDraftId) {
      try {
        await mailAPI.deleteDraft(state.composeDraftId, { mailboxId: resolveComposeMailboxId(state.composeFromMailboxId) });
      } catch {
        // ignore draft cleanup errors
      }
      clearStoredComposeDraft();
      onCloseSession?.();
      return;
    }
    if (composeStateHasContent(state) || state.composeDraftId) {
      try {
        await flushComposeDraft({ includeFiles: true });
      } catch {
        // fallback draft already persisted locally
      }
    }
    onCloseSession?.();
  }, [clearStoredComposeDraft, flushComposeDraft, onCloseSession, resolveComposeMailboxId]);

  const handleCloseComposeRef = useRef(handleCloseCompose);
  handleCloseComposeRef.current = handleCloseCompose;

  useEffect(() => {
    if (!onRegisterCloseHandler) return undefined;
    onRegisterCloseHandler(() => {
      void handleCloseComposeRef.current();
    });
    return () => onRegisterCloseHandler(null);
  }, [onRegisterCloseHandler]);

  const handleSendCompose = useCallback(async () => {
    const state = composeStateRef.current;
    const to = toRecipientEmails(state.composeToValues);
    const cc = toRecipientEmails(state.composeCcValues);
    const bcc = toRecipientEmails(state.composeBccValues);
    const validationErrors = {};
    if (to.length === 0) validationErrors.to = 'Укажите хотя бы одного получателя.';
    if (to.some((value) => !isValidEmail(value))) validationErrors.to = 'Проверьте адреса в поле "Кому".';
    if (cc.some((value) => !isValidEmail(value))) validationErrors.cc = 'Проверьте адреса в поле "Копия".';
    if (bcc.some((value) => !isValidEmail(value))) validationErrors.bcc = 'Проверьте адреса в поле "Скрытая копия".';
    if (Object.keys(validationErrors).length > 0) {
      patchComposeState({ composeFieldErrors: validationErrors });
      return;
    }
    patchComposeState({
      composeFieldErrors: {},
      composeError: '',
      composeSending: true,
      composeUploadProgress: 0,
    });
    try {
      if (state.composeFiles.length > 0) {
        const controller = new AbortController();
        composeUploadAbortRef.current = controller;
        await mailAPI.sendMessageMultipart({
          fromMailboxId: resolveComposeMailboxId(state.composeFromMailboxId),
          to,
          cc,
          bcc,
          subject: String(state.composeSubject || ''),
          body: String(getComposeCombinedBody(state) || ''),
          isHtml: true,
          replyToMessageId: state.composeReplyToMessageId,
          forwardMessageId: state.composeForwardMessageId,
          draftId: state.composeDraftId,
          files: state.composeFiles,
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
          body: String(getComposeCombinedBody(state) || ''),
          is_html: true,
          reply_to_message_id: state.composeReplyToMessageId,
          forward_message_id: state.composeForwardMessageId,
          draft_id: state.composeDraftId,
        });
      }
      clearStoredComposeDraft();
      await onSendSuccess?.();
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError, 'Не удалось отправить письмо.')) {
        patchComposeState({ composeError: '' });
      } else {
        patchComposeState({ composeError: getMailErrorDetail(requestError, 'Не удалось отправить письмо.') });
      }
    } finally {
      composeUploadAbortRef.current = null;
      patchComposeState({
        composeUploadProgress: 0,
        composeSending: false,
      });
    }
  }, [
    clearStoredComposeDraft,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    onSendSuccess,
    patchComposeState,
    resolveComposeMailboxId,
  ]);

  return (
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
      composeWarnings={composeWarnings}
      onDismissComposeWarning={(warningId) => patchComposeState((current) => ({
        dismissedComposeWarnings: [...new Set([...(current.dismissedComposeWarnings || []), String(warningId || '')])],
      }))}
      onComposePasteFiles={(files) => {
        const incoming = Array.isArray(files) ? files : Array.from(files || []);
        patchComposeState((current) => ({
          composeFiles: incoming.length > 0 ? [...current.composeFiles, ...incoming] : current.composeFiles,
        }));
      }}
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
      layoutMode={layoutMode}
    />
  );
}
