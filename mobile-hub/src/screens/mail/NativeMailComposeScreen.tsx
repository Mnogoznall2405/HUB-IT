import { NativeMailRichEditor, type NativeMailRichEditorHandle } from '../../components/mail/NativeMailRichEditor';
import type { MailRichSnapshot } from '../../mail/mailRichSnapshotRequest';
import { NativeMailHtmlBody } from '../../components/mail/NativeMailHtmlBody';
import { createMailComposeDraftSession, listLocalMailComposeDrafts, type MailComposeLocalDraft } from '../../mail/nativeMailComposeDrafts';
import { NativeMailRecipientInput as RecipientInput, recipientInputValue } from '../../components/mail/NativeMailRecipientInput';
import { acknowledgeMailComposeTransfer, takeMailComposeTransfer } from '../../mail/nativeMailComposeTransfer';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  deleteMailDraft,
  getMailMessage,
  saveMailDraft,
  searchMailContacts,
  sendMailMessage,
  type MailAttachment,
  type MailContact,
  type MailMessageDetail,
  type MailUploadFile,
} from '../../api/mailApi';
import { listMailboxes, type MailMailbox } from '../../api/mailMailboxesApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { pickMailAttachments } from '../../mail/nativeMailFiles';
import type { NativeMailComposeMode } from '../../mail/nativeMailFeature';
import {
  buildNativeMailContactSuggestions,
  buildNativeMailOutgoingHtml,
  composeVariantForMode,
  draftRecipients,
  hasExternalMailRecipients,
  invalidMailRecipients,
  mailBodyMentionsAttachment,
  mailByteLabel,
  mailDraftNeedsRichEditor,
  splitMailRecipients,
} from '../../mail/nativeMailModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { consumeIncomingShare } from '../../share/incomingShare';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

const AUTOSAVE_DELAY_MS = 2_500;

type RecipientField = 'to' | 'cc' | 'bcc';

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function composeTitle(mode: NativeMailComposeMode): string {
  if (mode === 'reply') return 'Ответ';
  if (mode === 'reply_all') return 'Ответ всем';
  if (mode === 'forward') return 'Пересылка';
  if (mode === 'draft') return 'Черновик';
  return 'Новое письмо';
}

function attachmentRefs(items: MailAttachment[]): string[] {
  return items.map((item) => String(item.download_token || item.id || '').trim()).filter(Boolean);
}

function createSendIdempotencyKey(): string {
  return Crypto.randomUUID?.()
    || `mail-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function NativeMailComposeScreen() {
  const params = useLocalSearchParams<{
    transferId?: string | string[];
    mode?: string | string[];
    mailboxId?: string | string[];
    sourceMessageId?: string | string[];
    draftId?: string | string[];
    to?: string | string[];
    subject?: string | string[];
  }>();
  const rawMode = first(params.mode);
  const requestedMode: NativeMailComposeMode = ['reply', 'reply_all', 'forward', 'draft'].includes(rawMode)
    ? rawMode as NativeMailComposeMode
    : 'new';
  const [mode, setMode] = useState(requestedMode);
  const initialMailboxId = first(params.mailboxId);
  const sourceMessageId = first(params.sourceMessageId);
  const initialDraftId = first(params.draftId);
  const initialTransferId = first(params.transferId);
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('mail.access');
  const currentAccessRef = useRef({ userId: user?.id, allowed, offlineMode });
  currentAccessRef.current = { userId: user?.id, allowed, offlineMode };
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [mailboxId, setMailboxId] = useState(initialMailboxId);
  const [to, setTo] = useState(recipientInputValue(splitMailRecipients(first(params.to))));
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(first(params.subject));
  const [body, setBody] = useState('');
  const transferredTextRef = useRef<{ userId: number; transferId: string; text: string } | null>(null);
  const ignoreInitialTransferRef = useRef(false);
  const previousTransferIdRef = useRef(initialTransferId);
  const [quoteHtml, setQuoteHtml] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [richEditing, setRichEditing] = useState(false);
  const [richReady, setRichReady] = useState(false);
  const richEditor = useRef<NativeMailRichEditorHandle>(null);
  const [quotePreview, setQuotePreview] = useState('');
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const [showCopies, setShowCopies] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [files, setFiles] = useState<MailUploadFile[]>([]);
  const [retainedAttachments, setRetainedAttachments] = useState<MailAttachment[]>([]);
  const [draftId, setDraftId] = useState(initialDraftId);
  const [replyToMessageId, setReplyToMessageId] = useState('');
  const [forwardMessageId, setForwardMessageId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [activeRecipient, setActiveRecipient] = useState<RecipientField>('to');
  const [contacts, setContacts] = useState<MailContact[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [richDraftRequiresWeb, setRichDraftRequiresWeb] = useState(false);
  const lastSavedFingerprintRef = useRef('');
  const saveRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const lastAutosaveAttemptRef = useRef('');
  const sendAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const sendInFlightRef = useRef(false);
  const [sendPending, setSendPending] = useState(false);
  const sendPendingRef = useRef(false);
  sendPendingRef.current = sendPending;
  const incomingShareAppliedRef = useRef(false);
  const localSessionRef = useRef<ReturnType<typeof createMailComposeDraftSession> | null>(null);
  const localPendingRef = useRef<MailComposeLocalDraft | null>(null);
  const preparationScopeRef = useRef<string | null>(null);
  const [localDraftStatus, setLocalDraftStatus] = useState('');
  const [offlineDrafts, setOfflineDrafts] = useState<Awaited<ReturnType<typeof listLocalMailComposeDrafts>>>([]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false; saveRequestRef.current += 1;
      if (localSessionRef.current && localPendingRef.current) void localSessionRef.current.write(localPendingRef.current).catch(() => undefined);
    };
  }, []);

  const fingerprint = useMemo(() => JSON.stringify({
    mailboxId,
    to,
    cc,
    bcc,
    subject,
    body,
    quoteHtml,
    bodyHtml, richEditing,
    retainedAttachments: attachmentRefs(retainedAttachments),
  }), [bcc, body, cc, mailboxId, quoteHtml, bodyHtml, richEditing, retainedAttachments, subject, to]);
  const sendFingerprint = useMemo(() => JSON.stringify({
    mailboxId,
    draftId,
    mode,
    to: splitMailRecipients(to),
    cc: splitMailRecipients(cc),
    bcc: splitMailRecipients(bcc),
    subject,
    body,
    quoteHtml,
    bodyHtml, richEditing,
    replyToMessageId,
    forwardMessageId,
    retainedAttachments: attachmentRefs(retainedAttachments),
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.mimeType,
      uri: file.uri,
    })),
  }), [bcc, body, cc, draftId, files, forwardMessageId, mailboxId, mode, quoteHtml, bodyHtml, richEditing, replyToMessageId, retainedAttachments, subject, to]);
  const currentSendFingerprintRef = useRef(sendFingerprint);
  currentSendFingerprintRef.current = sendFingerprint;
  const checkCurrentEditor = useCallback(() => {
    if (!mountedRef.current || currentAccessRef.current.userId !== user?.id || !currentAccessRef.current.allowed) return false;
    if (currentSendFingerprintRef.current !== sendFingerprint) {
      setError('Письмо изменилось. Повторите действие для текущей версии.');
      return false;
    }
    return true;
  }, [sendFingerprint, user?.id]);
  const localState = useMemo<MailComposeLocalDraft>(() => ({
    draftId, to, cc, bcc, subject, body, quoteHtml, replyToMessageId, forwardMessageId, retainedAttachments, files, richDraftRequiresWeb, bodyHtml, richEditing,
  }), [draftId, to, cc, bcc, subject, body, quoteHtml, replyToMessageId, forwardMessageId, retainedAttachments, files, richDraftRequiresWeb, bodyHtml, richEditing]);
  useEffect(() => {
    const session = localSessionRef.current;
    if (!initialized || !session) return;
    localPendingRef.current = localState;
    setLocalDraftStatus('Сохраняем на устройстве…');
    let active = true;
    const timer = setTimeout(() => {
      void session.write(localState).then((saved) => {
        if (!active || !mountedRef.current) return;
        if (localPendingRef.current === localState) localPendingRef.current = null;
        // Use the durable copy for subsequent uploads, not the picker cache URI.
        // Do not change the send fingerprint underneath an active request.
        if (!saveInFlightRef.current && !sendInFlightRef.current
          && saved.files.some((file, index) => file.uri !== localState.files[index]?.uri)) {
          setFiles((current) => current === localState.files ? saved.files : current);
        }
        setLocalDraftStatus('Сохранено на устройстве');
      }).catch(() => {
        if (active && mountedRef.current) setLocalDraftStatus('Не удалось сохранить на устройстве. Не закрывайте письмо.');
      });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [initialized, localState, saving, sending]);
  const hasUnsavedText = initialized && fingerprint !== lastSavedFingerprintRef.current;
  const currentFingerprintRef = useRef(fingerprint);
  currentFingerprintRef.current = fingerprint;
  const hasUnsavedChanges = initialized && (hasUnsavedText || files.length > 0);
  const modeChangeState = useRef({ dirty: hasUnsavedChanges, requestedMode });
  modeChangeState.current = { dirty: hasUnsavedChanges, requestedMode };
  useEffect(() => {
    if (requestedMode === mode) return;
    let resolved = false;
    const cancel = () => {
      if (resolved) return;
      resolved = true;
      if (modeChangeState.current.requestedMode === requestedMode) router.setParams({ mode });
    };
    const apply = () => {
      if (resolved || modeChangeState.current.requestedMode !== requestedMode) return;
      if (sendInFlightRef.current || saveInFlightRef.current) { cancel(); return; }
      resolved = true;
      ignoreInitialTransferRef.current = true;
      setInitialized(false);
      lastSavedFingerprintRef.current = '';
      transferredTextRef.current = null;
      setTo(''); setCc(''); setBcc(''); setBody(''); setBodyHtml(''); setRichEditing(false); setSubject('');
      setQuoteHtml(''); setQuotePreview(''); setQuoteExpanded(false);
      setFiles([]); setRetainedAttachments([]); setDraftId('');
      setReplyToMessageId(''); setForwardMessageId('');
      setRichDraftRequiresWeb(false); setShowCopies(false); setDraftStatus('');
      setMode(requestedMode);
      router.setParams({ transferId: undefined });
    };
    if (sendInFlightRef.current || saveInFlightRef.current) { cancel(); return; }
    if (!modeChangeState.current.dirty) { apply(); return; }
    Alert.alert('Изменить режим письма?', 'Несохранённые изменения будут потеряны.', [
      { text: 'Остаться', style: 'cancel', onPress: cancel },
      { text: 'Изменить режим', style: 'destructive', onPress: apply },
    ], { cancelable: true, onDismiss: cancel });
    return () => { resolved = true; };
  }, [mode, requestedMode]);
  const hasExternalRecipients = useMemo(() => {
    const selectedMailbox = mailboxes.find((item) => String(item.id) === mailboxId);
    return hasExternalMailRecipients([
      ...splitMailRecipients(to),
      ...splitMailRecipients(cc),
      ...splitMailRecipients(bcc),
    ], selectedMailbox?.mailbox_email);
  }, [bcc, cc, mailboxId, mailboxes, to]);

  useEffect(() => {
    if (incomingShareAppliedRef.current || mode !== 'new') return;
    incomingShareAppliedRef.current = true;
    const share = consumeIncomingShare('mail');
    if (!share) return;
    setSubject(share.subject.slice(0, 500));
    setBody(share.text);
  }, [mode]);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setInitialized(false);
    if (localSessionRef.current && localPendingRef.current) void localSessionRef.current.write(localPendingRef.current).catch(() => undefined);
    localPendingRef.current = null; localSessionRef.current = null;
    if (previousTransferIdRef.current !== initialTransferId) {
      if (initialTransferId) ignoreInitialTransferRef.current = false;
      previousTransferIdRef.current = initialTransferId;
    }
    const preparationScope = JSON.stringify([user?.id, initialMailboxId, sourceMessageId, initialDraftId, mode, initialTransferId]);
    if (preparationScopeRef.current !== null && preparationScopeRef.current !== preparationScope) {
      setTo(mode === 'new' ? recipientInputValue(splitMailRecipients(first(params.to))) : '');
      setSubject(mode === 'new' ? first(params.subject) : '');
      setCc(''); setBcc(''); setBody(''); setBodyHtml(''); setRichEditing(false);
      setQuoteHtml(''); setQuotePreview(''); setQuoteExpanded(false);
      setFiles([]); setRetainedAttachments([]); setDraftId('');
      setReplyToMessageId(''); setForwardMessageId(''); setRichDraftRequiresWeb(false);
      setShowCopies(false); setContacts([]); setDraftStatus(''); setSendPending(false);
      lastSavedFingerprintRef.current = '';
      transferredTextRef.current = null;
    }
    preparationScopeRef.current = preparationScope;
    const restoreLocal = async (selectedMailbox: string) => {
      if (user?.id && selectedMailbox) {
          const session = createMailComposeDraftSession({ userId: user.id, mailboxId: selectedMailbox, sourceId: sourceMessageId || initialDraftId, mode });
          const restored = await session.read();
          if (cancelled) return false;
          localSessionRef.current = session;
          const pendingSend = await session.hasPendingSend();
          if (cancelled) return false;
          setSendPending(pendingSend);
          if (restored && !first(params.transferId)) {
            setDraftId(restored.draftId); setTo(restored.to); setCc(restored.cc); setBcc(restored.bcc);
            setSubject(restored.subject); setBody(restored.body); setBodyHtml(restored.bodyHtml || ''); setRichEditing(restored.richEditing === true || Boolean(restored.richDraftRequiresWeb && restored.bodyHtml)); setQuoteHtml(restored.quoteHtml);
            setReplyToMessageId(restored.replyToMessageId); setForwardMessageId(restored.forwardMessageId);
            setRetainedAttachments(restored.retainedAttachments); setFiles(restored.files);
            setShowCopies(Boolean(restored.cc || restored.bcc));
            setRichDraftRequiresWeb(restored.richDraftRequiresWeb === true || (mode === 'draft' && restored.richDraftRequiresWeb === undefined));
            setMailboxId(selectedMailbox);
            lastSavedFingerprintRef.current = 'restored-local-draft';
            return true;
          }
        }
      return false;
    };
    (async () => {
      setLoading(true);
      setError('');
      try {
        if (offlineMode && !initialMailboxId) {
          const drafts = await listLocalMailComposeDrafts(Number(user?.id || 0));
          if (!cancelled) setOfflineDrafts(drafts);
          return;
        }
        if (offlineMode && initialMailboxId) {
          const restored = await restoreLocal(initialMailboxId);
          if (!cancelled) {
            if (restored) { setInitialized(true); setLocalDraftStatus('Открыт локальный черновик'); }
            else if (mode === 'new' && !sourceMessageId && !initialDraftId) {
              setInitialized(true); setLocalDraftStatus('Новое письмо будет сохранено на устройстве');
            }
            else setError('Локальный черновик этого письма не найден.');
          }
          return;
        }
        const [mailboxItems, source] = await Promise.all([
          listMailboxes(false),
          sourceMessageId || initialDraftId
            ? getMailMessage(sourceMessageId || initialDraftId, initialMailboxId)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const activeMailboxes = mailboxItems.filter((item) => item.is_active !== false);
        setMailboxes(activeMailboxes);
        const selectedMailbox = initialMailboxId
          || String(source?.mailbox_id || '')
          || String(activeMailboxes.find((item) => item.is_primary)?.id || activeMailboxes[0]?.id || '');
        setMailboxId(selectedMailbox);
        if (source) initializeFromSource(source);
        if (!ignoreInitialTransferRef.current && first(params.transferId) && user?.id && mode === 'reply') {
          const previous = transferredTextRef.current;
          const transferred = previous?.userId === user.id && previous.transferId === first(params.transferId)
            ? previous.text : takeMailComposeTransfer(first(params.transferId), {
            userId: user.id, mailboxId: selectedMailbox, messageId: sourceMessageId,
          });
          if (transferred === null) throw new Error('Не удалось перенести быстрый ответ. Вернитесь к письму и повторите.');
          if (transferred !== null) { transferredTextRef.current = { userId: user.id, transferId: first(params.transferId), text: transferred }; setBody(transferred); }
        }
        await restoreLocal(selectedMailbox);
        if (cancelled) return;
        queueMicrotask(() => {
          if (cancelled) return;
          setInitialized(true);
        });
      } catch (cause) {
        if (cancelled) return;
        try {
          if (initialMailboxId && await restoreLocal(initialMailboxId)) {
            if (!cancelled) { setInitialized(true); setError('Сервер недоступен. Открыт локальный черновик.'); }
            return;
          }
        } catch { /* Keep the original preparation failure; do not overwrite the local store. */ }
        if (!cancelled) setError(formatApiError(cause, 'Не удалось подготовить письмо.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, initialDraftId, initialMailboxId, initialTransferId, sourceMessageId, mode, user?.id, offlineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const initializeFromSource = useCallback((source: MailMessageDetail) => {
    // These fields belong to the previous source, even when the compose mode
    // stays the same. A matching local draft is restored after initialization.
    setFiles([]);
    setRetainedAttachments([]);
    setDraftId('');
    setBcc('');
    setReplyToMessageId('');
    setForwardMessageId('');
    setRichDraftRequiresWeb(false);
    if (mode === 'draft') {
      setRichDraftRequiresWeb(mailDraftNeedsRichEditor(source.body_html));
      setDraftId(source.id);
      setMailboxId(String(source.mailbox_id || initialMailboxId));
      setTo(recipientInputValue(draftRecipients(source, 'to')));
      setCc(recipientInputValue(draftRecipients(source, 'cc')));
      setBcc(recipientInputValue(draftRecipients(source, 'bcc')));
      setSubject(String(source.subject || ''));
      setBody(String(source.body_text || ''));
      setBodyHtml(mailDraftNeedsRichEditor(source.body_html) ? String(source.body_html || '') : '');
      setRichEditing(mailDraftNeedsRichEditor(source.body_html));
      setQuoteHtml('');
      setQuotePreview('');
      setShowCopies(Boolean((source.cc || []).length || (source.bcc || []).length));
      setRetainedAttachments(source.attachments || []);
      setReplyToMessageId(String(source.draft_context?.reply_to_message_id || ''));
      setForwardMessageId(String(source.draft_context?.forward_message_id || ''));
      return;
    }
    if (mode === 'reply' || mode === 'reply_all' || mode === 'forward') {
      const prepared = composeVariantForMode(source, mode);
      setMailboxId(String(source.mailbox_id || initialMailboxId));
      setTo(recipientInputValue(prepared.variant.to || []));
      setCc(recipientInputValue(prepared.variant.cc || []));
      setSubject(String(prepared.variant.subject || ''));
      setBody(prepared.body);
      setBodyHtml(''); setRichEditing(false);
      setQuoteHtml(prepared.quoteHtml);
      setQuotePreview(prepared.quotePreview);
      setQuoteExpanded(false);
      setShowCopies(Boolean((prepared.variant.cc || []).length));
      if (mode === 'forward') setForwardMessageId(source.id);
      else setReplyToMessageId(source.id);
    }
  }, [initialMailboxId, mode]);

  useEffect(() => {
    if (!initialized || lastSavedFingerprintRef.current) return;
    lastSavedFingerprintRef.current = transferredTextRef.current !== null ? 'unsaved-transfer' : fingerprint;
  }, [fingerprint, initialized]);

  const payload = useCallback((includeFiles: boolean, snapshot?: MailRichSnapshot | null) => {
    const hasQuote = Boolean(quoteHtml.trim());
    return {
      fromMailboxId: mailboxId,
      draftId,
      composeMode: mode,
      to: splitMailRecipients(to),
      cc: splitMailRecipients(cc),
      bcc: splitMailRecipients(bcc),
      subject,
      body: richEditing
        ? `${snapshot?.html ?? bodyHtml}${hasQuote ? buildNativeMailOutgoingHtml('', quoteHtml) : ''}`
        : hasQuote ? buildNativeMailOutgoingHtml(body, quoteHtml) : body,
      isHtml: richEditing || hasQuote,
      replyToMessageId,
      forwardMessageId,
      retainExistingAttachments: attachmentRefs(retainedAttachments),
      files: includeFiles ? files : [],
    };
  }, [bcc, body, cc, draftId, files, forwardMessageId, mailboxId, mode, quoteHtml, bodyHtml, richEditing, replyToMessageId, retainedAttachments, subject, to]);

  const saveDraft = useCallback(async ({ includeFiles, closeAfter = false, silent = false }: { includeFiles: boolean; closeAfter?: boolean; silent?: boolean }) => {
    if (!checkCurrentEditor() || saveInFlightRef.current || sendInFlightRef.current || saving || sending || sendPendingRef.current || offlineMode || (richDraftRequiresWeb && !richEditing) || (richEditing && !richReady)) return false;
    saveInFlightRef.current = true;
    const requestId = ++saveRequestRef.current;
    const session = localSessionRef.current;
    const ownsEditor = () => mountedRef.current && requestId === saveRequestRef.current
      && currentAccessRef.current.userId === user?.id && currentAccessRef.current.allowed
      && localSessionRef.current === session;
    setSaving(true);
    if (!silent) setDraftStatus('Сохраняем…');
    const editor = richEditor.current;
    let savedFingerprint = fingerprint;
    try {
      const snapshot = richEditing ? await editor!.snapshot() : null;
      if (!ownsEditor() || currentAccessRef.current.offlineMode) return false;
      if (snapshot) {
        setBody(snapshot.text); setBodyHtml(snapshot.html);
        savedFingerprint = JSON.stringify({ ...JSON.parse(fingerprint), body: snapshot.text, bodyHtml: snapshot.html });
      }
      let result = await saveMailDraft(payload(includeFiles, snapshot));
      if (!ownsEditor()) return false;
      const nextDraftId = String(result.draft_id || result.id || draftId || '').trim();
      if (!nextDraftId) throw new Error('Сервер не подтвердил сохранение черновика. Изменения оставлены в редакторе.');
      setDraftId(nextDraftId);
      const expectedAttachments = retainedAttachments.length + (includeFiles ? files.length : 0);
      if (expectedAttachments > 0 && (!Array.isArray(result.attachments) || attachmentRefs(result.attachments).length < expectedAttachments)) {
        // Reconcile an incomplete ACK before clearing local files or retrying upload.
        lastAutosaveAttemptRef.current = JSON.stringify({ ...JSON.parse(sendFingerprint), draftId: nextDraftId });
        const confirmed = await getMailMessage(nextDraftId, mailboxId);
        if (!ownsEditor()) return false;
        if (!Array.isArray(confirmed.attachments) || attachmentRefs(confirmed.attachments).length < expectedAttachments) {
          throw new Error('Сохранение вложений не подтверждено. Файлы оставлены в редакторе; проверьте серверный черновик перед повтором.');
        }
        result = { ...result, attachments: confirmed.attachments };
      }
      if (Array.isArray(result.attachments)) setRetainedAttachments(result.attachments);
      if (includeFiles) setFiles([]);
      lastSavedFingerprintRef.current = Array.isArray(result.attachments)
        ? JSON.stringify({ ...JSON.parse(savedFingerprint), retainedAttachments: attachmentRefs(result.attachments) })
        : savedFingerprint;
      setDraftStatus('Черновик сохранён');
      if (user?.id) void acknowledgeMailComposeTransfer(first(params.transferId), user.id).catch(() => undefined);
      if (closeAfter && currentFingerprintRef.current === savedFingerprint) goBackOrReplace('/(shell)/mail');
      return true;
    } catch (cause) {
      if (ownsEditor()) {
        const text = formatApiError(cause, 'Не удалось сохранить черновик.');
        if (silent) setDraftStatus(text); else setError(text);
      }
      return false;
    } finally {
      editor?.release();
      saveInFlightRef.current = false;
      if (requestId === saveRequestRef.current) setSaving(false);
    }
  }, [checkCurrentEditor, draftId, files.length, fingerprint, mailboxId, offlineMode, payload, retainedAttachments.length, richDraftRequiresWeb, richEditing, richReady, sendPending, saving, sendFingerprint, sending, user?.id]);

  useEffect(() => {
    if (!initialized || !hasUnsavedChanges || sending || saving || sendPending || offlineMode || (richDraftRequiresWeb && !richEditing) || (richEditing && !richReady)) return;
    if (lastAutosaveAttemptRef.current === sendFingerprint) return;
    const timer = setTimeout(() => {
      lastAutosaveAttemptRef.current = sendFingerprint;
      void saveDraft({ includeFiles: files.length > 0, silent: true });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [files.length, hasUnsavedChanges, initialized, offlineMode, richDraftRequiresWeb, richEditing, richReady, saveDraft, saving, sendPending, sendFingerprint, sending]);

  useEffect(() => {
    const current = activeRecipient === 'to' ? to : activeRecipient === 'cc' ? cc : bcc;
    const term = current.split(/[;,\n]/).pop()?.trim() || '';
    if (term.length < 2) {
      setContacts([]);
      return;
    }
    setContacts(buildNativeMailContactSuggestions(term));
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchMailContacts(term, mailboxId).then((items) => {
        if (!cancelled) setContacts(buildNativeMailContactSuggestions(term, items));
      }).catch(() => {
        if (!cancelled) setContacts(buildNativeMailContactSuggestions(term));
      });
    }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeRecipient, bcc, cc, mailboxId, to]);

  const addContact = useCallback((contact: MailContact) => {
    const email = String(contact.email || contact.value || '').trim();
    if (!email) return;
    const update = (value: string) => {
      const parts = value.split(/[;,\n]/);
      parts[parts.length - 1] = email;
      return `${parts.map((part) => part.trim()).filter(Boolean).join('; ')}; `;
    };
    if (activeRecipient === 'to') setTo(update);
    else if (activeRecipient === 'cc') setCc(update);
    else setBcc(update);
    setContacts([]);
  }, [activeRecipient]);

  const discardLocalDraftAndClose = useCallback(async () => {
    if (!checkCurrentEditor() || saveInFlightRef.current || sendInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaving(true);
    const session = localSessionRef.current;
    try {
      await session?.clear();
      if (!mountedRef.current || localSessionRef.current !== session) return;
      localPendingRef.current = null;
      localSessionRef.current = null;
      goBackOrReplace('/(shell)/mail');
    } catch {
      if (mountedRef.current && localSessionRef.current === session) {
        setError('Не удалось удалить локальный черновик. Повторите закрытие.');
      }
    } finally {
      saveInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [checkCurrentEditor]);

  const saveLocalAndClose = useCallback(async () => {
    if (!checkCurrentEditor() || saveInFlightRef.current || sendInFlightRef.current || !initialized) return;
    const session = localSessionRef.current;
    if (!session) {
      setError('Локальный черновик недоступен. Письмо оставлено в редакторе.');
      return;
    }
    if (richEditing && !richReady) {
      setError('Дождитесь восстановления редактора перед сохранением.');
      return;
    }
    const ownsEditor = () => mountedRef.current && currentAccessRef.current.userId === user?.id
      && currentAccessRef.current.allowed && localSessionRef.current === session;
    saveInFlightRef.current = true;
    setSaving(true);
    const editor = richEditor.current;
    try {
      const snapshot = richEditing ? await editor!.snapshot() : null;
      if (!ownsEditor()) return;
      const state = { ...localState, ...(snapshot ? { body: snapshot.text, bodyHtml: snapshot.html } : {}) };
      await session.write(state);
      if (!ownsEditor()) return;
      localPendingRef.current = null;
      setLocalDraftStatus('Сохранено на устройстве');
      goBackOrReplace('/(shell)/mail');
    } catch {
      if (ownsEditor()) setError('Не удалось сохранить на устройстве. Письмо оставлено в редакторе.');
    } finally {
      editor?.release();
      saveInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [checkCurrentEditor, initialized, localState, richEditing, richReady, user?.id]);

  const attemptClose = useCallback(() => {
    if (saveInFlightRef.current) return;
    if (sendInFlightRef.current) {
      Alert.alert('Письмо отправляется', 'Дождитесь результата отправки.');
      return;
    }
    if (!hasUnsavedChanges) {
      goBackOrReplace('/(shell)/mail');
      return;
    }
    Alert.alert('Закрыть письмо?', offlineMode ? 'Сохраните письмо на устройстве, чтобы продолжить без сети. Отправка не выполняется.' : files.length ? 'Новые вложения ещё не сохранены. Сохраните черновик перед закрытием.' : 'Несохранённые изменения можно оставить в черновике.', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Закрыть без изменений', style: 'destructive', onPress: () => { void discardLocalDraftAndClose(); } },
      { text: offlineMode ? 'Сохранить на устройстве и закрыть' : 'Сохранить и закрыть', onPress: () => { if (offlineMode) void saveLocalAndClose(); else void saveDraft({ includeFiles: true, closeAfter: true }); } },
    ]);
  }, [discardLocalDraftAndClose, files.length, hasUnsavedChanges, offlineMode, saveDraft, saveLocalAndClose]);

  useAndroidBackHandler(() => {
    attemptClose();
    return true;
  });

  const pickFiles = useCallback(async () => {
    if (offlineMode || sending || saving || !checkCurrentEditor()) return;
    const session = localSessionRef.current;
    const ownsEditor = () => mountedRef.current && currentAccessRef.current.userId === user?.id
      && currentAccessRef.current.allowed && localSessionRef.current === session;
    setError('');
    try {
      const picked = await pickMailAttachments(files);
      if (ownsEditor()) setFiles(picked);
    } catch (cause) {
      if (ownsEditor()) setError(formatApiError(cause, 'Не удалось добавить вложения.'));
    }
  }, [checkCurrentEditor, files, offlineMode, saving, sending, user?.id]);

  const send = useCallback(async () => {
    if (loading || saving || sending || offlineMode || (richDraftRequiresWeb && !richEditing) || (richEditing && !richReady)) return;
    const toValues = splitMailRecipients(to);
    const allRecipients = [...toValues, ...splitMailRecipients(cc), ...splitMailRecipients(bcc)];
    if (!toValues.length) {
      setError('Укажите хотя бы одного получателя в поле «Кому».');
      return;
    }
    const invalid = invalidMailRecipients(allRecipients);
    if (invalid.length) {
      setError(`Проверьте адреса: ${invalid.join(', ')}`);
      return;
    }
    const confirmSubjectAndSend = () => {
      if (!String(subject || '').trim()) {
        Alert.alert('Отправить без темы?', 'У письма не указана тема.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Отправить', onPress: () => { void performSend(); } },
        ]);
        return;
      }
      void performSend();
    };
    const regularRetainedCount = retainedAttachments.filter((attachment) => !attachment.is_inline).length;
    if (mailBodyMentionsAttachment(body) && files.length === 0 && regularRetainedCount === 0) {
      Alert.alert('Проверьте вложение', 'В тексте упомянуто вложение, но файлы не прикреплены.', [
        { text: 'Вернуться', style: 'cancel' },
        { text: 'Отправить без файла', onPress: confirmSubjectAndSend },
      ]);
      return;
    }
    confirmSubjectAndSend();
  }, [bcc, body, bodyHtml, cc, files.length, loading, offlineMode, retainedAttachments, richDraftRequiresWeb, richEditing, richReady, saving, sending, subject, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const performSend = useCallback(async (retryApproved = false): Promise<void> => {
    if (!checkCurrentEditor() || (richDraftRequiresWeb && !richEditing) || (richEditing && !richReady) || sendInFlightRef.current || saveInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSending(true);
    setUploadProgress(null);
    setError('');
    const localSession = localSessionRef.current;
    const editor = richEditor.current;
    const ownsEditor = () => mountedRef.current && currentAccessRef.current.userId === user?.id
      && currentAccessRef.current.allowed && localSessionRef.current === localSession;
    try {
      const snapshot = richEditing ? await editor!.snapshot() : null;
      if (!ownsEditor()) return;
      if (snapshot) { setBody(snapshot.text); setBodyHtml(snapshot.html); }
      if (!localSession) throw new Error('Локальный черновик недоступен. Отправка приостановлена для сохранности письма.');
      const prepared = await localSession.prepareSend({ ...localState, ...(snapshot ? { body: snapshot.text, bodyHtml: snapshot.html } : {}) }, createSendIdempotencyKey);
      if (!ownsEditor() || currentAccessRef.current.offlineMode) return;
      sendPendingRef.current = true; setSendPending(true);
      if (prepared.retry && !retryApproved) {
        Alert.alert('Повторить отправку?', 'Результат предыдущей отправки неизвестен. Проверьте папку «Отправленные»: повтор может создать второе письмо.', [
          { text: 'Вернуться', style: 'cancel' },
          { text: 'Повторить отправку', onPress: () => { void performSend(true); } },
        ]);
        return;
      }
      const sendKey = prepared.sendAttempt!.key;
      sendAttemptRef.current = { fingerprint: sendFingerprint, key: sendKey };
      await sendMailMessage({ ...payload(true, snapshot), files: prepared.state.files }, {
        idempotencyKey: sendKey,
        onUploadProgress: (event) => {
          if (!ownsEditor()) return;
          const total = Number(event.total || 0);
          setUploadProgress(total > 0 ? Math.min(1, Number(event.loaded || 0) / total) : null);
        },
      });
      await localSession.completeSend(sendKey).catch(() => undefined);
      if (user?.id) void acknowledgeMailComposeTransfer(first(params.transferId), user.id).catch(() => undefined);
      await localSession?.clear().catch(() => undefined);
      if (!ownsEditor()) return;
      localPendingRef.current = null;
      localSessionRef.current = null;
      sendAttemptRef.current = null; setSendPending(false);
      lastSavedFingerprintRef.current = fingerprint;
      router.replace({ pathname: '/(shell)/mail', params: { mailboxId, folder: 'sent' } } as never);
    } catch (cause) {
      if (ownsEditor()) setError(formatApiError(cause, 'Не удалось подтвердить отправку. Проверьте папку «Отправленные» перед повтором.'));
    } finally {
      editor?.release();
      sendInFlightRef.current = false;
      if (mountedRef.current) { setSending(false); setUploadProgress(null); }
    }
  }, [checkCurrentEditor, fingerprint, localState, mailboxId, payload, richDraftRequiresWeb, richEditing, richReady, sendFingerprint]);

  const deleteDraft = useCallback(() => {
    if (!draftId || sending || offlineMode) return;
    Alert.alert('Удалить черновик?', 'Текст и сохранённые вложения будут удалены.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => {
        if (!checkCurrentEditor() || saveInFlightRef.current || sendInFlightRef.current) return;
        saveInFlightRef.current = true;
        setSaving(true);
        void deleteMailDraft(draftId, mailboxId).then(() => {
          if (!mountedRef.current) return;
          localPendingRef.current = null;
          const localSession = localSessionRef.current; localSessionRef.current = null;
          void localSession?.clear().catch(() => undefined);
          lastSavedFingerprintRef.current = fingerprint;
          goBackOrReplace('/(shell)/mail');
        }).catch((cause) => {
          if (mountedRef.current) setError(formatApiError(cause, 'Не удалось удалить черновик.'));
        }).finally(() => {
          saveInFlightRef.current = false;
          if (mountedRef.current) setSaving(false);
        });
      } },
    ]);
  }, [checkCurrentEditor, draftId, fingerprint, mailboxId, offlineMode, sending]);

  if (!allowed) {
    return <AccountScreenScaffold title="Письмо" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  if (offlineMode && !initialMailboxId) {
    return <AccountScreenScaffold title="Локальные черновики" tokens={tokens} onBack={attemptClose}>
      {loading ? <ActivityIndicator color={tokens.primary} /> : <AccountSectionCard tokens={tokens}
        title="Сохранено на устройстве" description="Выберите письмо, чтобы продолжить редактирование без подключения.">
        {error ? <Text accessibilityRole="alert" style={{ color: tokens.textPrimary }}>{error}</Text> : null}
        {!error && offlineDrafts.length === 0 ? <Text style={{ color: tokens.textSecondary }}>Локальных черновиков пока нет.</Text> : null}
        {offlineDrafts.map((draft) => <Pressable key={JSON.stringify([draft.mailboxId, draft.sourceId, draft.mode])}
          accessibilityRole="button" style={{ padding: 12, minHeight: 56 }}
          onPress={() => router.setParams({ mailboxId: draft.mailboxId, mode: draft.mode,
            sourceMessageId: draft.mode === 'draft' ? undefined : draft.sourceId,
            draftId: draft.mode === 'draft' ? draft.sourceId : undefined, transferId: undefined })}>
          <Text style={{ color: tokens.textPrimary, fontSize: 16 }}>{draft.subject || 'Без темы'}</Text>
          <Text style={{ color: tokens.textSecondary }}>{composeTitle(draft.mode as NativeMailComposeMode)}</Text>
        </Pressable>)}
      </AccountSectionCard>}
    </AccountScreenScaffold>;
  }

  if (!loading && !initialized) {
    return <AccountScreenScaffold title={composeTitle(mode)} tokens={tokens} onBack={attemptClose}>
      <AccountSectionCard tokens={tokens} title="Не удалось открыть редактор"
        description={error || 'Данные письма пока недоступны. Вернитесь к списку и повторите открытие.'}>
        <Pressable accessibilityRole="button" onPress={() => goBackOrReplace('/(shell)/mail')} style={styles.secondaryButton}>
          <Text style={{ color: tokens.primary }}>К списку писем</Text>
        </Pressable>
      </AccountSectionCard>
    </AccountScreenScaffold>;
  }

  if (richDraftRequiresWeb && !richEditing) {
    return (
      <AccountScreenScaffold title="Форматированный черновик" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}>
        <AccountSectionCard
          tokens={tokens}
          title="Форматированный черновик защищён"
          description="Этот черновик содержит HTML и встроенное оформление. Редактирование временно недоступно, чтобы приложение не повредило содержимое."
        >{null}</AccountSectionCard>
        {localDraftStatus ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>{localDraftStatus}</Text> : null}
        {bodyHtml ? <NativeMailHtmlBody bodyHtml={bodyHtml} plainText={body} attachments={retainedAttachments} tokens={tokens} /> : null}
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title={composeTitle(mode)}
      tokens={tokens}
      onBack={attemptClose}
      rightAction={(
        <View style={styles.headerActions}>
          <Pressable testID="native-mail-add-files" disabled={loading || sending || saving || offlineMode} onPress={() => { void pickFiles(); }} accessibilityRole="button" accessibilityLabel="Добавить вложения" style={styles.headerAction}><MaterialCommunityIcons name="paperclip-plus" size={22} color={tokens.primary} /></Pressable>
          <Pressable testID="native-mail-compose-more" accessibilityRole="button" accessibilityLabel="Действия с черновиком" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen(!moreOpen)} style={styles.headerAction}><MaterialCommunityIcons name="dots-horizontal" size={23} color={tokens.iconMuted} /></Pressable>
          <Pressable testID="native-mail-send" onPress={() => { void send(); }} disabled={sending || saving || offlineMode || loading || (richEditing && !richReady)} accessibilityRole="button" accessibilityLabel="Отправить письмо" accessibilityState={{ disabled: sending || saving || offlineMode || loading || (richEditing && !richReady), busy: sending }} style={[styles.headerAction, { opacity: sending || saving || offlineMode || loading || (richEditing && !richReady) ? 0.5 : 1 }]}>
            {sending ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="send" size={23} color={tokens.primary} />}
          </Pressable>
        </View>
      )}
    >
      {loading ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : (
        <>
          {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Нет сети: отправка и сохранение на сервере недоступны. Состояние локальной копии показано ниже.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {sendPending ? <View><Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Предыдущая отправка ещё не подтверждена. Проверьте «Отправленные» перед повтором. Сохранение на сервере приостановлено.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Проверить отправленные" disabled={sending || saving} style={styles.secondaryButton} onPress={() => router.push({ pathname: '/(shell)/mail', params: { mailboxId, folder: 'sent' } } as never)}><Text style={{ color: tokens.primary }}>Проверить отправленные</Text></Pressable>
          </View> : null}
          {hasExternalRecipients ? <Text accessibilityLiveRegion="polite" style={[styles.externalNotice, { color: tokens.primary }]}>В письме есть внешние получатели. Проверьте адреса перед отправкой.</Text> : null}
          <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>{localDraftStatus}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.draftStatus, { color: draftStatus.includes('Не удалось') ? tokens.error : tokens.textSecondary }]}>{sending ? (uploadProgress === null ? 'Отправляем…' : `Загрузка ${Math.round(uploadProgress * 100)}%`) : saving ? 'Сохраняем…' : files.length && draftStatus === 'Черновик сохранён' ? 'Текст сохранён. Новые вложения ещё не сохранены.' : files.length && !hasUnsavedText && !draftStatus ? 'Новые вложения ещё не сохранены.' : draftStatus || 'Черновик сохраняется автоматически'}</Text>
          {moreOpen ? <View style={styles.footerActions}>
            <Pressable testID="native-mail-save-draft" disabled={saving || sending || sendPending || offlineMode || loading || (richEditing && !richReady)} accessibilityRole="button" onPress={() => { void saveDraft({ includeFiles: true }); }} style={[styles.secondaryButton, { borderColor: tokens.border, opacity: saving || sending || sendPending || offlineMode || loading || (richEditing && !richReady) ? 0.5 : 1 }]}><MaterialCommunityIcons name="content-save-outline" size={20} color={tokens.primary} /><Text style={[styles.secondaryText, { color: tokens.primary }]}>Сохранить</Text></Pressable>
          </View> : null}
          {moreOpen && draftId ? <Pressable disabled={saving || sending || offlineMode} accessibilityRole="button" onPress={deleteDraft} style={styles.deleteDraft}><MaterialCommunityIcons name="trash-can-outline" size={19} color={tokens.error} /><Text style={[styles.deleteDraftText, { color: tokens.error }]}>Удалить черновик</Text></Pressable> : null}
          {mailboxes.length > 1 ? (
            <View style={styles.fieldBlock}>
              <Text style={[styles.label, { color: tokens.textSecondary }]}>Отправитель</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mailboxRow}>
                {mailboxes.map((mailbox) => <ComposeChip disabled={sending || saving} key={mailbox.id} label={mailbox.label || mailbox.mailbox_email || 'Ящик'} selected={mailboxId === String(mailbox.id)} tokens={tokens} onPress={() => setMailboxId(String(mailbox.id))} />)}
              </ScrollView>
            </View>
          ) : null}
          <RecipientInput disabled={sending || saving} label="Кому" value={to} tokens={tokens} testID="native-mail-to" onFocus={() => setActiveRecipient('to')} onChangeText={setTo} rightAction={<Pressable accessibilityRole="button" accessibilityLabel={showCopies ? 'Скрыть копии' : 'Добавить копию'} onPress={() => setShowCopies((value) => !value)} style={styles.inlineAction}><Text style={[styles.inlineActionText, { color: tokens.primary }]}>Копия</Text></Pressable>} />
          {showCopies ? (
            <>
              <RecipientInput disabled={sending || saving} label="Копия" value={cc} tokens={tokens} onFocus={() => setActiveRecipient('cc')} onChangeText={setCc} />
              <RecipientInput disabled={sending || saving} label="Скрытая копия" value={bcc} tokens={tokens} onFocus={() => setActiveRecipient('bcc')} onChangeText={setBcc} />
            </>
          ) : null}
          {contacts.length ? (
            <View style={[styles.suggestions, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
              {contacts.map((contact, index) => {
                const email = String(contact.email || contact.value || '');
                const label = String(contact.display || contact.name || email);
                return <Pressable key={`${email}:${index}`} disabled={sending || saving} testID={`native-mail-contact-suggestion-${index}`} accessibilityRole="button" accessibilityLabel={label} onPress={() => addContact(contact)} style={styles.suggestion}><MaterialCommunityIcons name="account-outline" size={19} color={tokens.iconMuted} /><View style={styles.suggestionText}><Text numberOfLines={1} style={[styles.suggestionName, { color: tokens.textPrimary }]}>{label}</Text><Text numberOfLines={1} style={[styles.suggestionEmail, { color: tokens.textSecondary }]}>{email}</Text></View></Pressable>;
              })}
            </View>
          ) : null}
          <ComposeField disabled={sending || saving} label="Тема" value={subject} tokens={tokens} testID="native-mail-subject" onChangeText={setSubject} />
          <View style={styles.fieldBlock}>
            <Text style={[styles.label, { color: tokens.textSecondary }]}>{quoteHtml ? 'Текст ответа' : 'Текст письма'}</Text>
            {richEditing ? <NativeMailRichEditor
              ref={richEditor} key={`${user?.id}:${initialMailboxId}:${sourceMessageId}:${initialDraftId}:${mode}`}
              initialHtml={bodyHtml} disabled={sending || saving} tokens={tokens}
              onReady={setRichReady} onChange={(value) => { setBody(value.text); setBodyHtml(value.html); }}
            /> : <>
            <TextInput
              testID="native-mail-body"
              editable={!sending && !saving}
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
              placeholder="Введите сообщение"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Текст письма"
              style={[styles.bodyInput, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]}
            />
              <Pressable accessibilityRole="button" accessibilityLabel="Форматировать текст" disabled={sending || saving} style={styles.headerAction} onPress={() => { setBodyHtml(buildNativeMailOutgoingHtml(body)); setRichEditing(true); }}><Text style={{ color: tokens.primary }}>Форматирование</Text></Pressable>
            </>}

          </View>
          {quoteHtml ? (
            <View style={[styles.quoteCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}> 
              <Pressable
                testID="native-mail-quote-toggle"
                accessibilityRole="button"
                accessibilityLabel={quoteExpanded ? 'Скрыть исходное письмо' : 'Показать исходное письмо'}
                accessibilityState={{ expanded: quoteExpanded }}
                onPress={() => setQuoteExpanded((current) => !current)}
                style={({ pressed }) => [styles.quoteHeader, { backgroundColor: pressed ? tokens.panelInset : tokens.panelSolid }]}
              >
                <MaterialCommunityIcons name="reply-outline" size={20} color={tokens.iconMuted} />
                <View style={styles.quoteHeaderText}>
                  <Text style={[styles.quoteTitle, { color: tokens.textPrimary }]}>Исходное письмо</Text>
                  <Text style={[styles.quoteHint, { color: tokens.textSecondary }]}>Будет добавлено к ответу с исходным форматированием</Text>
                </View>
                <MaterialCommunityIcons name={quoteExpanded ? 'chevron-up' : 'chevron-down'} size={21} color={tokens.iconMuted} />
              </Pressable>
              {quoteExpanded ? (
                <Text testID="native-mail-quote-preview" selectable style={[styles.quotePreview, { color: tokens.textSecondary, borderTopColor: tokens.borderSoft }]}> 
                  {quotePreview || 'Исходное письмо будет добавлено при отправке.'}
                </Text>
              ) : null}
            </View>
          ) : null}
          {retainedAttachments.length || files.length ? (
          <View style={[styles.attachmentPanel, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}> 
            <View style={styles.attachmentHeader}>
              <View><Text style={[styles.attachmentTitle, { color: tokens.textPrimary }]}>Вложения</Text><Text style={[styles.attachmentHint, { color: tokens.textSecondary }]}>До 10 файлов, 15 МБ каждый, 25 МБ суммарно</Text></View>

            </View>
            {retainedAttachments.map((attachment, index) => {
              const ref = String(attachment.download_token || attachment.id || index);
              return <AttachmentRow key={ref} disabled={sending || saving} name={attachment.name} size={Number(attachment.size || 0)} saved tokens={tokens} onRemove={() => setRetainedAttachments((current) => current.filter((item) => item !== attachment))} />;
            })}
            {files.map((file) => <AttachmentRow key={`${file.uri}:${file.name}`} disabled={sending || saving} name={file.name} size={file.size} tokens={tokens} onRemove={() => setFiles((current) => current.filter((item) => item.uri !== file.uri))} />)}
          </View>
          ) : null}

        </>
      )}
    </AccountScreenScaffold>
  );
}

function ComposeField({ disabled = false, label, value, tokens, testID, onChangeText }: { disabled?: boolean; label: string; value: string; tokens: FluentTokens; testID?: string; onChangeText: (value: string) => void }) {
  return <View style={styles.fieldBlock}><Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text><TextInput editable={!disabled} testID={testID} value={value} onChangeText={onChangeText} accessibilityLabel={label} style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]} /></View>;
}

function ComposeChip({ disabled = false, label, selected, tokens, onPress }: { disabled?: boolean; label: string; selected: boolean; tokens: FluentTokens; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ selected, disabled }} onPress={onPress} style={[styles.composeChip, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.selectedBorder : tokens.borderSoft }]}><Text style={[styles.composeChipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text></Pressable>;
}

function AttachmentRow({ disabled = false, name, size, saved, tokens, onRemove }: { disabled?: boolean; name: string; size: number; saved?: boolean; tokens: FluentTokens; onRemove?: () => void }) {
  return <View style={[styles.attachmentRow, { borderTopColor: tokens.borderSoft }]}><MaterialCommunityIcons name={saved ? 'cloud-check-outline' : 'file-outline'} size={20} color={tokens.iconMuted} /><View style={styles.attachmentText}><Text selectable style={[styles.attachmentName, { color: tokens.textPrimary }]}>{name}</Text><Text style={[styles.attachmentSize, { color: tokens.textTertiary }]}>{mailByteLabel(size)}{saved ? ' · сохранено' : ''}</Text></View>{onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить вложение ${name}`} disabled={disabled} accessibilityState={{ disabled }} onPress={onRemove} style={styles.removeAttachment}><MaterialCommunityIcons name="close" size={19} color={tokens.error} /></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: 8, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  externalNotice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  draftStatus: { minHeight: 24, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  fieldBlock: { marginBottom: 4 },
  labelRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginBottom: 5, fontSize: 12, fontWeight: '800' },
  inlineAction: { minHeight: 44, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  bodyInput: { minHeight: 220, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22 },
  quoteCard: { marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  quoteHeader: { minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  quoteHeaderText: { flex: 1, minWidth: 0 },
  quoteTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  quoteHint: { marginTop: 1, fontSize: 12, lineHeight: 18 },
  quotePreview: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 20 },
  mailboxRow: { gap: 8 },
  composeChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  composeChipText: { fontSize: 12, fontWeight: '800' },
  suggestions: { marginTop: -8, marginBottom: 12, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  suggestion: { minHeight: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  suggestionText: { flex: 1, minWidth: 0 },
  suggestionName: { fontSize: 13, fontWeight: '800' },
  suggestionEmail: { marginTop: 1, fontSize: 11 },
  attachmentPanel: { borderWidth: 1, borderRadius: 14, padding: 12 },
  attachmentHeader: { minHeight: 46, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  attachmentTitle: { fontSize: 14, fontWeight: '900' },
  attachmentHint: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  attachmentRow: { minHeight: 60, paddingVertical: 8, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentText: { flex: 1, minWidth: 0 },
  attachmentName: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  attachmentSize: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  removeAttachment: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center' },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  secondaryButton: { flexGrow: 1, flexBasis: 140, minHeight: 50, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryText: { fontSize: 13, fontWeight: '900' },
  deleteDraft: { minHeight: 48, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  deleteDraftText: { fontSize: 12, fontWeight: '800' },
});
