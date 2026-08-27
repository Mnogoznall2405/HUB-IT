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
    mode?: string | string[];
    mailboxId?: string | string[];
    sourceMessageId?: string | string[];
    draftId?: string | string[];
    to?: string | string[];
    subject?: string | string[];
  }>();
  const rawMode = first(params.mode);
  const mode: NativeMailComposeMode = ['reply', 'reply_all', 'forward', 'draft'].includes(rawMode)
    ? rawMode as NativeMailComposeMode
    : 'new';
  const initialMailboxId = first(params.mailboxId);
  const sourceMessageId = first(params.sourceMessageId);
  const initialDraftId = first(params.draftId);
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('mail.access');
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [mailboxId, setMailboxId] = useState(initialMailboxId);
  const [to, setTo] = useState(first(params.to));
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(first(params.subject));
  const [body, setBody] = useState('');
  const [quoteHtml, setQuoteHtml] = useState('');
  const [quotePreview, setQuotePreview] = useState('');
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const [showCopies, setShowCopies] = useState(false);
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
  const sendAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const incomingShareAppliedRef = useRef(false);

  const fingerprint = useMemo(() => JSON.stringify({
    mailboxId,
    to,
    cc,
    bcc,
    subject,
    body,
    quoteHtml,
    retainedAttachments: attachmentRefs(retainedAttachments),
  }), [bcc, body, cc, mailboxId, quoteHtml, retainedAttachments, subject, to]);
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
    replyToMessageId,
    forwardMessageId,
    retainedAttachments: attachmentRefs(retainedAttachments),
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.mimeType,
      uri: file.uri,
    })),
  }), [bcc, body, cc, draftId, files, forwardMessageId, mailboxId, mode, quoteHtml, replyToMessageId, retainedAttachments, subject, to]);
  const hasUnsavedChanges = initialized && (
    fingerprint !== lastSavedFingerprintRef.current || files.length > 0
  );
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
    (async () => {
      setLoading(true);
      setError('');
      try {
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
        queueMicrotask(() => {
          if (cancelled) return;
          setInitialized(true);
        });
      } catch (cause) {
        if (!cancelled) setError(formatApiError(cause, 'Не удалось подготовить письмо.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, initialDraftId, initialMailboxId, sourceMessageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const initializeFromSource = useCallback((source: MailMessageDetail) => {
    if (mode === 'draft') {
      setRichDraftRequiresWeb(mailDraftNeedsRichEditor(source.body_html));
      setDraftId(source.id);
      setMailboxId(String(source.mailbox_id || initialMailboxId));
      setTo(draftRecipients(source, 'to').join('; '));
      setCc(draftRecipients(source, 'cc').join('; '));
      setBcc(draftRecipients(source, 'bcc').join('; '));
      setSubject(String(source.subject || ''));
      setBody(String(source.body_text || ''));
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
      setTo((prepared.variant.to || []).join('; '));
      setCc((prepared.variant.cc || []).join('; '));
      setSubject(String(prepared.variant.subject || ''));
      setBody(prepared.body);
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
    lastSavedFingerprintRef.current = fingerprint;
  }, [fingerprint, initialized]);

  const payload = useCallback((includeFiles: boolean) => {
    const hasQuote = Boolean(quoteHtml.trim());
    return {
      fromMailboxId: mailboxId,
      draftId,
      composeMode: mode,
      to: splitMailRecipients(to),
      cc: splitMailRecipients(cc),
      bcc: splitMailRecipients(bcc),
      subject,
      body: hasQuote ? buildNativeMailOutgoingHtml(body, quoteHtml) : body,
      isHtml: hasQuote,
      replyToMessageId,
      forwardMessageId,
      retainExistingAttachments: attachmentRefs(retainedAttachments),
      files: includeFiles ? files : [],
    };
  }, [bcc, body, cc, draftId, files, forwardMessageId, mailboxId, mode, quoteHtml, replyToMessageId, retainedAttachments, subject, to]);

  const saveDraft = useCallback(async ({ includeFiles, closeAfter = false, silent = false }: { includeFiles: boolean; closeAfter?: boolean; silent?: boolean }) => {
    if (saving || sending || offlineMode || richDraftRequiresWeb) return false;
    const requestId = ++saveRequestRef.current;
    setSaving(true);
    if (!silent) setDraftStatus('Сохраняем…');
    try {
      const result = await saveMailDraft(payload(includeFiles));
      if (requestId !== saveRequestRef.current) return false;
      const nextDraftId = String(result.draft_id || result.id || draftId || '').trim();
      if (nextDraftId) setDraftId(nextDraftId);
      if (Array.isArray(result.attachments)) setRetainedAttachments(result.attachments);
      if (includeFiles) setFiles([]);
      lastSavedFingerprintRef.current = fingerprint;
      setDraftStatus('Черновик сохранён');
      if (closeAfter) goBackOrReplace('/(shell)/mail');
      return true;
    } catch (cause) {
      if (requestId === saveRequestRef.current) {
        const text = formatApiError(cause, 'Не удалось сохранить черновик.');
        if (silent) setDraftStatus(text); else setError(text);
      }
      return false;
    } finally {
      if (requestId === saveRequestRef.current) setSaving(false);
    }
  }, [draftId, fingerprint, offlineMode, payload, richDraftRequiresWeb, saving, sending]);

  useEffect(() => {
    if (!initialized || !hasUnsavedChanges || sending || saving || offlineMode) return;
    const timer = setTimeout(() => { void saveDraft({ includeFiles: false, silent: true }); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasUnsavedChanges, initialized, offlineMode, saveDraft, saving, sending]);

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

  const attemptClose = useCallback(() => {
    if (!hasUnsavedChanges) {
      goBackOrReplace('/(shell)/mail');
      return;
    }
    Alert.alert('Закрыть письмо?', files.length ? 'Текст автосохраняется, но новые вложения нужно сохранить отдельно.' : 'Несохранённые изменения можно оставить в черновике.', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Закрыть без изменений', style: 'destructive', onPress: () => goBackOrReplace('/(shell)/mail') },
      { text: 'Сохранить и закрыть', onPress: () => { void saveDraft({ includeFiles: true, closeAfter: true }); } },
    ]);
  }, [files.length, hasUnsavedChanges, saveDraft]);

  useAndroidBackHandler(() => {
    attemptClose();
    return true;
  });

  const pickFiles = useCallback(async () => {
    if (offlineMode || sending) return;
    setError('');
    try {
      setFiles(await pickMailAttachments(files));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось добавить вложения.'));
    }
  }, [files, offlineMode, sending]);

  const send = useCallback(async () => {
    if (sending || offlineMode || richDraftRequiresWeb) return;
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
  }, [bcc, body, cc, files.length, offlineMode, retainedAttachments, richDraftRequiresWeb, sending, subject, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const performSend = useCallback(async () => {
    if (richDraftRequiresWeb) return;
    setSending(true);
    setUploadProgress(null);
    setError('');
    try {
      if (!sendAttemptRef.current || sendAttemptRef.current.fingerprint !== sendFingerprint) {
        sendAttemptRef.current = {
          fingerprint: sendFingerprint,
          key: createSendIdempotencyKey(),
        };
      }
      await sendMailMessage(payload(true), {
        idempotencyKey: sendAttemptRef.current.key,
        onUploadProgress: (event) => {
          const total = Number(event.total || 0);
          setUploadProgress(total > 0 ? Math.min(1, Number(event.loaded || 0) / total) : null);
        },
      });
      sendAttemptRef.current = null;
      lastSavedFingerprintRef.current = fingerprint;
      router.replace({ pathname: '/(shell)/mail', params: { mailboxId, folder: 'sent' } } as never);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось подтвердить отправку. Проверьте папку «Отправленные» перед повтором.'));
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  }, [fingerprint, mailboxId, payload, richDraftRequiresWeb, sendFingerprint]);

  const deleteDraft = useCallback(() => {
    if (!draftId || sending || offlineMode) return;
    Alert.alert('Удалить черновик?', 'Текст и сохранённые вложения будут удалены.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => {
        setSaving(true);
        void deleteMailDraft(draftId, mailboxId).then(() => {
          lastSavedFingerprintRef.current = fingerprint;
          goBackOrReplace('/(shell)/mail');
        }).catch((cause) => setError(formatApiError(cause, 'Не удалось удалить черновик.'))).finally(() => setSaving(false));
      } },
    ]);
  }, [draftId, fingerprint, mailboxId, offlineMode, sending]);

  if (!allowed) {
    return <AccountScreenScaffold title="Письмо" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  if (richDraftRequiresWeb) {
    return (
      <AccountScreenScaffold title="Форматированный черновик" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}>
        <AccountSectionCard
          tokens={tokens}
          title="Форматированный черновик защищён"
          description="Этот черновик содержит HTML и встроенное оформление. Редактирование временно недоступно, чтобы приложение не повредило содержимое."
        >{null}</AccountSectionCard>
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
          <Pressable testID="native-mail-send" onPress={() => { void send(); }} disabled={sending || saving || offlineMode} accessibilityRole="button" accessibilityLabel="Отправить письмо" accessibilityState={{ disabled: sending || saving || offlineMode, busy: sending }} style={[styles.headerAction, { opacity: sending || saving || offlineMode ? 0.5 : 1 }]}>
            {sending ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="send" size={23} color={tokens.primary} />}
          </Pressable>
        </View>
      )}
    >
      {loading ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : (
        <>
          {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: отправка и сохранение недоступны.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {hasExternalRecipients ? <Text accessibilityLiveRegion="polite" style={[styles.externalNotice, { color: tokens.primary }]}>В письме есть внешние получатели. Проверьте адреса перед отправкой.</Text> : null}
          <Text accessibilityLiveRegion="polite" style={[styles.draftStatus, { color: draftStatus.includes('Не удалось') ? tokens.error : tokens.textSecondary }]}>{sending ? (uploadProgress === null ? 'Отправляем…' : `Загрузка ${Math.round(uploadProgress * 100)}%`) : saving ? 'Сохраняем…' : draftStatus || 'Черновик сохраняется автоматически'}</Text>
          {mailboxes.length > 1 ? (
            <View style={styles.fieldBlock}>
              <Text style={[styles.label, { color: tokens.textSecondary }]}>Отправитель</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mailboxRow}>
                {mailboxes.map((mailbox) => <ComposeChip key={mailbox.id} label={mailbox.label || mailbox.mailbox_email || 'Ящик'} selected={mailboxId === String(mailbox.id)} tokens={tokens} onPress={() => setMailboxId(String(mailbox.id))} />)}
              </ScrollView>
            </View>
          ) : null}
          <RecipientInput label="Кому" value={to} tokens={tokens} testID="native-mail-to" onFocus={() => setActiveRecipient('to')} onChangeText={setTo} rightAction={<Pressable accessibilityRole="button" accessibilityLabel={showCopies ? 'Скрыть копии' : 'Добавить копию'} onPress={() => setShowCopies((value) => !value)} style={styles.inlineAction}><Text style={[styles.inlineActionText, { color: tokens.primary }]}>Копия</Text></Pressable>} />
          {showCopies ? (
            <>
              <RecipientInput label="Копия" value={cc} tokens={tokens} onFocus={() => setActiveRecipient('cc')} onChangeText={setCc} />
              <RecipientInput label="Скрытая копия" value={bcc} tokens={tokens} onFocus={() => setActiveRecipient('bcc')} onChangeText={setBcc} />
            </>
          ) : null}
          {contacts.length ? (
            <View style={[styles.suggestions, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
              {contacts.map((contact, index) => {
                const email = String(contact.email || contact.value || '');
                const label = String(contact.display || contact.name || email);
                return <Pressable key={`${email}:${index}`} testID={`native-mail-contact-suggestion-${index}`} accessibilityRole="button" accessibilityLabel={label} onPress={() => addContact(contact)} style={styles.suggestion}><MaterialCommunityIcons name="account-outline" size={19} color={tokens.iconMuted} /><View style={styles.suggestionText}><Text numberOfLines={1} style={[styles.suggestionName, { color: tokens.textPrimary }]}>{label}</Text><Text numberOfLines={1} style={[styles.suggestionEmail, { color: tokens.textSecondary }]}>{email}</Text></View></Pressable>;
              })}
            </View>
          ) : null}
          <ComposeField label="Тема" value={subject} tokens={tokens} testID="native-mail-subject" onChangeText={setSubject} />
          <View style={styles.fieldBlock}>
            <Text style={[styles.label, { color: tokens.textSecondary }]}>{quoteHtml ? 'Текст ответа' : 'Текст письма'}</Text>
            <TextInput
              testID="native-mail-body"
              value={body}
              onChangeText={setBody}
              multiline
              textAlignVertical="top"
              placeholder="Введите сообщение"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Текст письма"
              style={[styles.bodyInput, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]}
            />
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
                  <Text numberOfLines={1} style={[styles.quoteHint, { color: tokens.textSecondary }]}>Будет добавлено к ответу с исходным форматированием</Text>
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
          <View style={[styles.attachmentPanel, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}> 
            <View style={styles.attachmentHeader}>
              <View><Text style={[styles.attachmentTitle, { color: tokens.textPrimary }]}>Вложения</Text><Text style={[styles.attachmentHint, { color: tokens.textSecondary }]}>До 10 файлов, 15 МБ каждый, 25 МБ суммарно</Text></View>
              <Pressable testID="native-mail-add-files" disabled={sending || offlineMode} onPress={() => { void pickFiles(); }} accessibilityRole="button" accessibilityLabel="Добавить вложения" style={styles.addAttachment}><MaterialCommunityIcons name="paperclip-plus" size={22} color={tokens.primary} /></Pressable>
            </View>
            {retainedAttachments.map((attachment, index) => {
              const ref = String(attachment.download_token || attachment.id || index);
              return <AttachmentRow key={ref} name={attachment.name} size={Number(attachment.size || 0)} saved tokens={tokens} onRemove={() => setRetainedAttachments((current) => current.filter((item) => item !== attachment))} />;
            })}
            {files.map((file) => <AttachmentRow key={`${file.uri}:${file.name}`} name={file.name} size={file.size} tokens={tokens} onRemove={() => setFiles((current) => current.filter((item) => item.uri !== file.uri))} />)}
            {!retainedAttachments.length && !files.length ? <Text style={[styles.emptyAttachments, { color: tokens.textTertiary }]}>Файлы не добавлены</Text> : null}
          </View>
          <View style={styles.footerActions}>
            <Pressable testID="native-mail-save-draft" disabled={saving || sending || offlineMode} accessibilityRole="button" onPress={() => { void saveDraft({ includeFiles: true }); }} style={[styles.secondaryButton, { borderColor: tokens.border, opacity: saving || sending || offlineMode ? 0.5 : 1 }]}><MaterialCommunityIcons name="content-save-outline" size={20} color={tokens.primary} /><Text style={[styles.secondaryText, { color: tokens.primary }]}>Сохранить</Text></Pressable>
            <Pressable disabled={saving || sending || offlineMode} accessibilityRole="button" onPress={() => { void send(); }} style={[styles.sendButton, { backgroundColor: tokens.primary, opacity: saving || sending || offlineMode ? 0.5 : 1 }]}>{sending ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="send" size={20} color="#fff" />}<Text style={styles.sendText}>Отправить</Text></Pressable>
          </View>
          {draftId ? <Pressable disabled={saving || sending || offlineMode} accessibilityRole="button" onPress={deleteDraft} style={styles.deleteDraft}><MaterialCommunityIcons name="trash-can-outline" size={19} color={tokens.error} /><Text style={[styles.deleteDraftText, { color: tokens.error }]}>Удалить черновик</Text></Pressable> : null}
        </>
      )}
    </AccountScreenScaffold>
  );
}

function ComposeField({ label, value, tokens, testID, onChangeText }: { label: string; value: string; tokens: FluentTokens; testID?: string; onChangeText: (value: string) => void }) {
  return <View style={styles.fieldBlock}><Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text><TextInput testID={testID} value={value} onChangeText={onChangeText} accessibilityLabel={label} style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]} /></View>;
}

function RecipientInput({ label, value, tokens, testID, rightAction, onFocus, onChangeText }: { label: string; value: string; tokens: FluentTokens; testID?: string; rightAction?: React.ReactNode; onFocus: () => void; onChangeText: (value: string) => void }) {
  return <View style={styles.fieldBlock}><View style={styles.labelRow}><Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>{rightAction}</View><TextInput testID={testID} value={value} onFocus={onFocus} onChangeText={onChangeText} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" accessibilityLabel={label} placeholder="name@example.com; …" placeholderTextColor={tokens.textTertiary} style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]} /></View>;
}

function ComposeChip({ label, selected, tokens, onPress }: { label: string; selected: boolean; tokens: FluentTokens; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.composeChip, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.selectedBorder : tokens.borderSoft }]}><Text style={[styles.composeChipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text></Pressable>;
}

function AttachmentRow({ name, size, saved, tokens, onRemove }: { name: string; size: number; saved?: boolean; tokens: FluentTokens; onRemove?: () => void }) {
  return <View style={[styles.attachmentRow, { borderTopColor: tokens.borderSoft }]}><MaterialCommunityIcons name={saved ? 'cloud-check-outline' : 'file-outline'} size={20} color={tokens.iconMuted} /><View style={styles.attachmentText}><Text numberOfLines={1} style={[styles.attachmentName, { color: tokens.textPrimary }]}>{name}</Text><Text style={[styles.attachmentSize, { color: tokens.textTertiary }]}>{mailByteLabel(size)}{saved ? ' · сохранено' : ''}</Text></View>{onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить вложение ${name}`} onPress={onRemove} style={styles.removeAttachment}><MaterialCommunityIcons name="close" size={19} color={tokens.error} /></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: 8, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  externalNotice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  draftStatus: { minHeight: 24, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  fieldBlock: { marginBottom: 12 },
  labelRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginBottom: 5, fontSize: 12, fontWeight: '800' },
  inlineAction: { minHeight: 32, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  bodyInput: { minHeight: 220, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22 },
  quoteCard: { marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  quoteHeader: { minHeight: 60, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  quoteHeaderText: { flex: 1, minWidth: 0 },
  quoteTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  quoteHint: { marginTop: 1, fontSize: 11, lineHeight: 16 },
  quotePreview: { maxHeight: 180, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 20 },
  mailboxRow: { gap: 8 },
  composeChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  composeChipText: { fontSize: 12, fontWeight: '800' },
  suggestions: { marginTop: -8, marginBottom: 12, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  suggestion: { minHeight: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  suggestionText: { flex: 1, minWidth: 0 },
  suggestionName: { fontSize: 13, fontWeight: '800' },
  suggestionEmail: { marginTop: 1, fontSize: 11 },
  attachmentPanel: { borderWidth: 1, borderRadius: 14, padding: 12 },
  attachmentHeader: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  attachmentTitle: { fontSize: 14, fontWeight: '900' },
  attachmentHint: { marginTop: 2, fontSize: 10, lineHeight: 14 },
  addAttachment: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachmentRow: { minHeight: 54, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentText: { flex: 1, minWidth: 0 },
  attachmentName: { fontSize: 12, fontWeight: '800' },
  attachmentSize: { marginTop: 2, fontSize: 10 },
  removeAttachment: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center' },
  emptyAttachments: { paddingVertical: 12, fontSize: 12 },
  footerActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryButton: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryText: { fontSize: 13, fontWeight: '900' },
  sendButton: { flex: 1, minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sendText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  deleteDraft: { minHeight: 48, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  deleteDraftText: { fontSize: 12, fontWeight: '800' },
});
