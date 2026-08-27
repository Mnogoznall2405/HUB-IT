import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteMailMessage,
  getMailConversation,
  getMailFolderTree,
  getMailMessage,
  getMailMessageHeaders,
  markMailMessageRead,
  markMailMessageUnread,
  moveMailMessage,
  restoreMailMessage,
  sendMailMessage,
  setMailMessageImportance,
  summarizeMailMessage,
  type MailAttachment,
  type MailFolderNode,
  type MailMessageDetail,
  type MailMessageHeaders,
} from '../../api/mailApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  formatNativeSnapshotSavedAt,
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { NativeMailMessageCard } from '../../components/mail/NativeMailMessageCard';
import { NativeMailImageViewer } from '../../components/mail/NativeMailImageViewer';
import { NativeMailQuickReplyBar } from '../../components/mail/NativeMailQuickReplyBar';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import {
  getNativeMailAttachmentKind,
  resolveNativeMailAttachmentMimeType,
} from '../../mail/nativeMailAttachmentVisual';
import { saveNativeMailAttachmentsToDirectory } from '../../mail/nativeMailAttachmentSave';
import {
  buildNativeMailImageGallery,
  nativeMailAttachmentReference,
  withNativeMailAttachmentPreview,
} from '../../mail/nativeMailAttachments';
import {
  downloadMailAttachment,
  downloadMailAttachmentPreviewPdf,
  downloadMailMessageSource,
  hydrateNativeMailImages,
} from '../../mail/nativeMailFiles';
import { nativeMailComposeDestination } from '../../mail/nativeMailFeature';
import { buildNativeMailFolderOptions } from '../../mail/nativeMailFolders';
import { buildNativeMailOutgoingHtml, composeVariantForMode, mailSubject } from '../../mail/nativeMailModel';
import { buildNativeMailPrintHtml } from '../../mail/nativeMailPrint';
import {
  clearPendingMailReadOverride,
  stagePendingMailReadOverride,
} from '../../mail/nativeMailReadOverrides';
import { publishNativeMailUnreadDelta } from '../../mail/nativeMailUnreadEvents';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function parseMessageSequence(value: string | string[] | undefined): string[] {
  const source = first(value);
  if (!source || source.length > 32_000) return [];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 50);
  } catch {
    return [];
  }
}

function plural(value: number, one: string, few: string, many: string): string {
  const normalized = Math.abs(Math.trunc(value));
  const mod100 = normalized % 100;
  const mod10 = normalized % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function quickReplyIdempotencyKey(): string {
  return Crypto.randomUUID?.()
    || `mail-quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function NativeMailMessageScreen() {
  const params = useLocalSearchParams<{ messageId?: string | string[]; mailboxId?: string | string[]; folder?: string | string[]; sequence?: string | string[] }>();
  const messageId = first(params.messageId);
  const mailboxIdParam = first(params.mailboxId);
  const folderParam = first(params.folder);
  const sequence = useMemo(() => parseMessageSequence(params.sequence), [params.sequence]);
  const sequenceIndex = sequence.indexOf(messageId);
  const previousMessageId = sequenceIndex > 0 ? sequence[sequenceIndex - 1] : '';
  const nextMessageId = sequenceIndex >= 0 && sequenceIndex < sequence.length - 1 ? sequence[sequenceIndex + 1] : '';
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const safeAreaBottom = initialWindowMetrics?.insets.bottom || 0;
  const allowed = hasPermission('mail.access');
  const [message, setMessage] = useState<MailMessageDetail | null>(null);
  const [folderTree, setFolderTree] = useState<MailFolderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyAttachment, setBusyAttachment] = useState('');
  const [error, setError] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [fileActionsOpen, setFileActionsOpen] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(false);
  const [headersLoading, setHeadersLoading] = useState(false);
  const [headers, setHeaders] = useState<MailMessageHeaders>({ items: [] });
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [threadStats, setThreadStats] = useState<{ messages: number; unread: number } | null>(null);
  const [quickReply, setQuickReply] = useState('');
  const [quickReplyBusy, setQuickReplyBusy] = useState(false);
  const [quickReplyStatus, setQuickReplyStatus] = useState('');
  const [imageViewerKey, setImageViewerKey] = useState('');
  const [imageViewerLoading, setImageViewerLoading] = useState(false);
  const quickReplyKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const autoReadMessageIdRef = useRef('');
  const moveTargets = useMemo(
    () => buildNativeMailFolderOptions(folderTree).filter((folder) => folder.id !== String(message?.folder || folderParam || '')),
    [folderParam, folderTree, message?.folder],
  );
  const imageViewerItems = useMemo(() => buildNativeMailImageGallery(message ? [message] : []), [message]);
  const imageViewerItem = imageViewerItems.find((item) => item.key === imageViewerKey) || null;
  const snapshotKey = `${mailboxIdParam}:${messageId}`;

  const load = useCallback(async () => {
    if (!allowed || !messageId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setSummary('');
    setThreadStats(null);
    if (offlineMode) {
      const cached = user?.id
        ? await readNativeEntitySnapshot<MailMessageDetail>('mail-message-details', user.id, snapshotKey)
        : null;
      if (cached) {
        setMessage(cached.data);
        setCachedAt(cached.savedAt);
      } else {
        setMessage(null);
        setCachedAt(0);
        setError('Нет подключения и сохранённой копии письма. Откройте его один раз при наличии сети.');
      }
      setLoading(false);
      return;
    }
    try {
      const [detail, treeResult] = await Promise.all([
        getMailMessage(messageId, mailboxIdParam),
        getMailFolderTree(mailboxIdParam).catch(() => null),
      ]);
      setMessage(detail);
      setCachedAt(0);
      void hydrateNativeMailImages(
        detail.id,
        String(detail.mailbox_id || mailboxIdParam),
        detail.attachments || [],
      ).then((attachments) => {
        setMessage((current) => current?.id === detail.id ? { ...current, attachments } : current);
      }).catch(() => undefined);
      if (treeResult) setFolderTree(treeResult.items);
      const loadThreadStats = () => {
        if (!detail.conversation_id) return Promise.resolve();
        return getMailConversation(detail.conversation_id, {
          mailboxId: String(detail.mailbox_id || mailboxIdParam),
          folder: String(detail.folder || folderParam || 'inbox'),
          folderScope: 'current',
        }).then((conversation) => {
          setThreadStats({
            messages: Math.max(1, Number(conversation.messages_count || conversation.items?.length || 1)),
            unread: Math.max(0, Number(conversation.unread_count || 0)),
          });
        }).catch(() => undefined);
      };
      if (detail.is_read === false && autoReadMessageIdRef.current !== detail.id && !offlineMode) {
        const detailMailboxId = String(detail.mailbox_id || mailboxIdParam);
        const isInbox = String(detail.folder || folderParam || 'inbox') === 'inbox';
        autoReadMessageIdRef.current = detail.id;
        stagePendingMailReadOverride(detail.id, detailMailboxId);
        setMessage((current) => current ? { ...current, is_read: true } : current);
        if (isInbox) publishNativeMailUnreadDelta(-1);
        void markMailMessageRead(detail.id, detailMailboxId).then(() => {
          clearPendingMailReadOverride(detail.id, detailMailboxId);
          void loadThreadStats();
        }).catch(() => {
          clearPendingMailReadOverride(detail.id, detailMailboxId);
          autoReadMessageIdRef.current = '';
          setMessage((current) => current?.id === detail.id ? { ...current, is_read: false } : current);
          if (isInbox) publishNativeMailUnreadDelta(1);
          setError('Письмо открылось, но не отметилось прочитанным.');
          void loadThreadStats();
        });
      } else {
        void loadThreadStats();
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть письмо.'));
    } finally {
      setLoading(false);
    }
  }, [allowed, folderParam, mailboxIdParam, messageId, offlineMode, snapshotKey, user?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!message || offlineMode || !user?.id) return;
    void writeNativeEntitySnapshot('mail-message-details', user.id, snapshotKey, message);
  }, [message, offlineMode, snapshotKey, user?.id]);
  useEffect(() => {
    autoReadMessageIdRef.current = '';
    setQuickReply('');
    setQuickReplyStatus('');
    setImageViewerKey('');
    quickReplyKeyRef.current = null;
  }, [messageId]);

  useEffect(() => {
    if (offlineMode || !message || !imageViewerItem || imageViewerItem.uri) return undefined;
    let active = true;
    setImageViewerLoading(true);
    void downloadMailAttachment(
      imageViewerItem.messageId,
      imageViewerItem.mailboxId || mailboxIdParam,
      imageViewerItem.attachment,
    ).then((file) => {
      if (!active) return;
      setImageViewerLoading(false);
      setMessage((current) => current?.id === imageViewerItem.messageId
        ? withNativeMailAttachmentPreview(current, imageViewerItem.attachment, file.uri)
        : current);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить изображение.'));
    }).finally(() => {
      if (active) setImageViewerLoading(false);
    });
    return () => { active = false; };
  }, [imageViewerItem?.key, imageViewerItem?.uri, mailboxIdParam, message, offlineMode]);

  const exactPortalPath = useCallback(() => {
    const query = new URLSearchParams({ message: messageId });
    if (mailboxIdParam) query.set('mailbox_id', mailboxIdParam);
    if (folderParam) query.set('folder', folderParam);
    return `/mail?${query.toString()}`;
  }, [folderParam, mailboxIdParam, messageId]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, fallback: string, after?: () => void) => {
    if (busy || offlineMode) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      after?.();
    } catch (cause) {
      setError(formatApiError(cause, fallback));
    } finally {
      setBusy(false);
    }
  }, [busy, offlineMode]);

  const compose = useCallback((mode: 'reply' | 'reply_all' | 'forward' | 'draft') => {
    if (!message) return;
    router.push(nativeMailComposeDestination({
      mode,
      mailboxId: message.mailbox_id || mailboxIdParam,
      sourceMessageId: mode === 'draft' ? undefined : message.id,
      draftId: mode === 'draft' ? message.id : undefined,
    }) as never);
  }, [mailboxIdParam, message]);

  const sendQuickReply = useCallback(async () => {
    const body = quickReply.trim();
    if (!message || !body || quickReplyBusy || offlineMode) return;
    const { variant, quoteHtml } = composeVariantForMode(message, 'reply');
    const to = (variant.to || []).map(String).filter(Boolean);
    const fallbackRecipient = String(message.sender_email || message.sender_person?.email || message.sender || '').trim();
    if (!to.length && fallbackRecipient) to.push(fallbackRecipient);
    if (!to.length) {
      setError('Не удалось определить получателя быстрого ответа. Откройте полный редактор.');
      return;
    }
    const fingerprint = `${message.id}\n${body}`;
    if (quickReplyKeyRef.current?.fingerprint !== fingerprint) {
      quickReplyKeyRef.current = { fingerprint, key: quickReplyIdempotencyKey() };
    }
    setQuickReplyBusy(true);
    setQuickReplyStatus('');
    setError('');
    try {
      await sendMailMessage({
        fromMailboxId: String(message.compose_context?.mailbox_id || message.mailbox_id || mailboxIdParam),
        composeMode: 'reply',
        to,
        cc: (variant.cc || []).map(String).filter(Boolean),
        subject: String(variant.subject || message.subject || ''),
        body: buildNativeMailOutgoingHtml(body, quoteHtml),
        isHtml: true,
        replyToMessageId: message.id,
      }, { idempotencyKey: quickReplyKeyRef.current.key });
      quickReplyKeyRef.current = null;
      setQuickReply('');
      setQuickReplyStatus('Ответ отправлен');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить быстрый ответ. Повторная попытка будет безопасной.'));
    } finally {
      setQuickReplyBusy(false);
    }
  }, [mailboxIdParam, message, offlineMode, quickReply, quickReplyBusy]);

  const openAdjacentMessage = useCallback((targetMessageId: string) => {
    if (!targetMessageId) return;
    router.replace({
      pathname: '/(shell)/mail/[messageId]',
      params: {
        messageId: targetMessageId,
        mailboxId: mailboxIdParam,
        folder: folderParam,
        sequence: JSON.stringify(sequence),
      },
    } as never);
  }, [folderParam, mailboxIdParam, sequence]);

  const loadSummary = useCallback(async () => {
    if (!message || summaryLoading || offlineMode) return;
    if (summary) {
      setSummary('');
      return;
    }
    setSummaryLoading(true);
    setError('');
    try {
      const result = await summarizeMailMessage(message.id, String(message.mailbox_id || mailboxIdParam));
      const nextSummary = String(result.summary || '').trim();
      if (!nextSummary) throw new Error('AI вернул пустой пересказ.');
      setSummary(nextSummary);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось пересказать письмо.'));
    } finally {
      setSummaryLoading(false);
    }
  }, [mailboxIdParam, message, offlineMode, summary, summaryLoading]);

  const toggleImportance = useCallback(() => {
    if (!message) return;
    const importance = message.importance === 'high' ? 'normal' : 'high';
    void mutate(
      () => setMailMessageImportance(message.id, importance, String(message.mailbox_id || mailboxIdParam)),
      'Не удалось изменить важность.',
      () => setMessage((current) => current ? { ...current, importance } : current),
    );
  }, [mailboxIdParam, message, mutate]);

  const confirmDelete = useCallback(() => {
    if (!message) return;
    const permanent = message.folder === 'trash';
    Alert.alert(permanent ? 'Удалить письмо навсегда?' : 'Удалить письмо?', permanent ? 'Это действие нельзя отменить.' : 'Письмо будет перемещено в «Удалённые».', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => { void mutate(
          () => deleteMailMessage(message.id, String(message.mailbox_id || mailboxIdParam), permanent),
          'Не удалось удалить письмо.',
          () => goBackOrReplace('/(shell)/mail'),
        ); },
      },
    ]);
  }, [mailboxIdParam, message, mutate]);

  const useAttachment = useCallback(async (attachment: MailAttachment, action: 'open' | 'share' | 'preview') => {
    if (!message || busyAttachment) return;
    const ref = String(attachment.download_token || attachment.id || 'file');
    setBusyAttachment(ref);
    setError('');
    try {
      const scopedMailboxId = String(message.mailbox_id || mailboxIdParam);
      if (action === 'preview') {
        const preview = await downloadMailAttachmentPreviewPdf(message.id, scopedMailboxId, attachment);
        await openNativeFile(preview, 'application/pdf');
      } else {
        const file = await downloadMailAttachment(message.id, scopedMailboxId, attachment);
        const mimeType = resolveNativeMailAttachmentMimeType(attachment, file.type);
        if (action === 'share') await shareNativeFile(file, attachment.name, mimeType);
        else await openNativeFile(file, mimeType);
      }
    } catch (cause) {
      setError(formatApiError(cause, action === 'share'
        ? 'Не удалось поделиться вложением.'
        : action === 'preview'
          ? 'Не удалось открыть PDF-предпросмотр.'
          : 'Не удалось открыть вложение.'));
    } finally {
      setBusyAttachment('');
    }
  }, [busyAttachment, mailboxIdParam, message]);

  const saveAllAttachments = useCallback(async (attachments: MailAttachment[]) => {
    if (!message || busyAttachment || offlineMode) return;
    setBusyAttachment('__all__');
    setError('');
    try {
      const result = await saveNativeMailAttachmentsToDirectory(
        message.id,
        String(message.mailbox_id || mailboxIdParam),
        attachments,
      );
      if (result.cancelled) return;
      if (result.failed.length) {
        setError(`Сохранено ${result.saved.length} из ${attachments.length}. Не удалось: ${result.failed.map((item) => item.name).join(', ')}.`);
      } else {
        Alert.alert('Вложения сохранены', `Сохранено вложений: ${result.saved.length}. Папка: «${result.directoryName}».`);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить вложения.'));
    } finally {
      setBusyAttachment('');
    }
  }, [busyAttachment, mailboxIdParam, message, offlineMode]);

  const openAttachment = useCallback((attachment: MailAttachment) => {
    if (!message) return;
    if (getNativeMailAttachmentKind(attachment) === 'image') {
      const reference = nativeMailAttachmentReference(attachment, '');
      const item = imageViewerItems.find((candidate) => nativeMailAttachmentReference(candidate.attachment, '') === reference);
      if (item) setImageViewerKey(item.key);
      return;
    }
    void useAttachment(attachment, 'open');
  }, [imageViewerItems, message, useAttachment]);

  const openHeaders = useCallback(async () => {
    if (!message || headersLoading) return;
    setFileActionsOpen(false);
    setHeadersOpen(true);
    setHeadersLoading(true);
    setHeaders({ items: [] });
    setError('');
    try {
      setHeaders(await getMailMessageHeaders(message.id, String(message.mailbox_id || mailboxIdParam)));
    } catch (cause) {
      setHeadersOpen(false);
      setError(formatApiError(cause, 'Не удалось загрузить заголовки письма.'));
    } finally {
      setHeadersLoading(false);
    }
  }, [headersLoading, mailboxIdParam, message]);

  const shareSource = useCallback(async () => {
    if (!message || busy || offlineMode) return;
    setFileActionsOpen(false);
    setBusy(true);
    setError('');
    try {
      const file = await downloadMailMessageSource(
        message.id,
        String(message.mailbox_id || mailboxIdParam),
        mailSubject(message),
      );
      await shareNativeFile(file, `${mailSubject(message)}.eml`, 'message/rfc822');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось скачать исходник письма.'));
    } finally {
      setBusy(false);
    }
  }, [busy, mailboxIdParam, message, offlineMode]);

  const printMessage = useCallback(async () => {
    if (!message || busy) return;
    setFileActionsOpen(false);
    setBusy(true);
    setError('');
    try {
      await Print.printAsync({ html: buildNativeMailPrintHtml(message) });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось напечатать письмо.'));
    } finally {
      setBusy(false);
    }
  }, [busy, message]);

  if (!allowed) {
    return <AccountScreenScaffold title="Письмо" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <SafeAreaView style={[styles.readerSafe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      <View style={styles.readerTopBar}>
        <Pressable
          testID="native-mail-reader-back"
          onPress={() => goBackOrReplace('/(shell)/mail')}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          style={styles.readerTopAction}
        >
          <MaterialCommunityIcons name="chevron-left" size={38} color={tokens.textPrimary} />
        </Pressable>
        <View style={styles.readerTopSpacer} />
        <Pressable
          testID="native-mail-previous-message"
          onPress={() => openAdjacentMessage(previousMessageId)}
          disabled={!previousMessageId}
          accessibilityRole="button"
          accessibilityLabel="Предыдущее письмо"
          accessibilityState={{ disabled: !previousMessageId }}
          style={[styles.readerTopAction, !previousMessageId ? styles.readerTopActionDisabled : null]}
        >
          <MaterialCommunityIcons name="chevron-up" size={38} color={tokens.textPrimary} />
        </Pressable>
        <Pressable
          testID="native-mail-next-message"
          onPress={() => openAdjacentMessage(nextMessageId)}
          disabled={!nextMessageId}
          accessibilityRole="button"
          accessibilityLabel="Следующее письмо"
          accessibilityState={{ disabled: !nextMessageId }}
          style={[styles.readerTopAction, !nextMessageId ? styles.readerTopActionDisabled : null]}
        >
          <MaterialCommunityIcons name="chevron-down" size={38} color={tokens.textPrimary} />
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.readerMain} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        testID="native-mail-reader-scroll"
        style={styles.readerScroll}
        contentContainerStyle={styles.readerScrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} tintColor={tokens.primary} />}
      >
      {loading && !message ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {offlineMode ? (
        <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>
          Автономный режим: действия с письмом недоступны.{cachedAt ? ` Копия от ${formatNativeSnapshotSavedAt(cachedAt)}.` : ''}
        </Text>
      ) : null}
      {message ? (
        <>
          <View style={styles.subjectBlock}>
            <Text testID="native-mail-reader-subject" accessibilityRole="header" style={[styles.subject, { color: tokens.textPrimary }]}>{mailSubject(message)}</Text>
            <View testID="native-mail-thread-meta" style={styles.metaRow}>
              <Text style={[styles.threadMetaText, { color: tokens.textSecondary }]}>
                {threadStats?.messages || 1} {plural(threadStats?.messages || 1, 'письмо', 'письма', 'писем')}
              </Text>
              <View style={[styles.unreadDot, { backgroundColor: tokens.error }]} />
              <Text style={[styles.threadMetaText, { color: tokens.textSecondary }]}>
                {threadStats?.unread ?? (message.is_read === false ? 1 : 0)} {plural(threadStats?.unread ?? (message.is_read === false ? 1 : 0), 'непрочитанное', 'непрочитанных', 'непрочитанных')}
              </Text>
            </View>
          </View>
          <NativeMailMessageCard
            message={message}
            tokens={tokens}
            reader
            readerAccessory={(
              <View style={styles.summaryBlock}>
                <Pressable
                  testID="native-mail-summarize"
                  accessibilityRole="button"
                  accessibilityLabel={summary ? 'Скрыть пересказ письма' : 'Пересказать письмо'}
                  accessibilityState={{ disabled: summaryLoading || offlineMode, busy: summaryLoading, expanded: Boolean(summary) }}
                  disabled={summaryLoading || offlineMode}
                  onPress={() => { void loadSummary(); }}
                  style={({ pressed }) => [
                    styles.summaryButton,
                    { backgroundColor: pressed ? tokens.panelInset : tokens.panelMuted },
                  ]}
                >
                  {summaryLoading ? <ActivityIndicator size="small" color={tokens.error} /> : <MaterialCommunityIcons name="water-outline" size={22} color={tokens.error} />}
                  <Text style={[styles.summaryButtonText, { color: tokens.textPrimary }]}>{summaryLoading ? 'Пересказываю…' : 'Пересказать'}</Text>
                </Pressable>
                {summary ? (
                  <View testID="native-mail-summary" style={[styles.summaryResult, { backgroundColor: tokens.accentSoft }]}>
                    <Text selectable style={[styles.summaryText, { color: tokens.textPrimary }]}>{summary}</Text>
                  </View>
                ) : null}
              </View>
            )}
            busyAttachment={busyAttachment}
            onOpenAttachment={openAttachment}
            onShareAttachment={(attachment) => { void useAttachment(attachment, 'share'); }}
            onPreviewAttachment={(attachment) => { void useAttachment(attachment, 'preview'); }}
            onSaveAllAttachments={(attachments) => { void saveAllAttachments(attachments); }}
          />
          {message.folder === 'drafts' || message.draft_context ? (
            <Pressable testID="native-mail-edit-draft" accessibilityRole="button" onPress={() => compose('draft')} style={[styles.primaryAction, { backgroundColor: tokens.primary }]}>
              <MaterialCommunityIcons name="file-edit-outline" size={21} color="#fff" />
              <Text style={styles.primaryActionText}>Продолжить черновик</Text>
            </Pressable>
          ) : null}
          <Modal visible={fileActionsOpen} transparent animationType="slide" onRequestClose={() => setFileActionsOpen(false)}>
            <View style={styles.modalRoot}>
              <Pressable style={styles.backdropDismissLayer} onPress={() => setFileActionsOpen(false)} accessibilityRole="button" accessibilityLabel="Закрыть дополнительные действия" />
              <View testID="native-mail-file-actions-sheet" style={[styles.actionSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <View style={styles.moveHeader}>
                  <View style={styles.moveHeaderText}>
                    <Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>Дополнительные действия</Text>
                    <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Действия с письмом и технические сведения.</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setFileActionsOpen(false)} style={styles.modalClose}>
                    <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
                  </Pressable>
                </View>
                <ScrollView style={styles.actionList} contentContainerStyle={styles.actionListContent}>
                  {message.folder !== 'drafts' && !message.draft_context ? (
                    <ActionRow icon="reply-all-outline" label="Ответить всем" disabled={false} tokens={tokens} onPress={() => {
                      setFileActionsOpen(false);
                      compose('reply_all');
                    }} />
                  ) : null}
                  <ActionRow
                    icon={message.is_read ? 'email-outline' : 'email-open-outline'}
                    label={message.is_read ? 'Отметить непрочитанным' : 'Отметить прочитанным'}
                    disabled={busy || offlineMode}
                    tokens={tokens}
                    onPress={() => {
                      setFileActionsOpen(false);
                      const wasRead = Boolean(message.is_read);
                      void mutate(
                        () => wasRead
                          ? markMailMessageUnread(message.id, String(message.mailbox_id || mailboxIdParam))
                          : markMailMessageRead(message.id, String(message.mailbox_id || mailboxIdParam)),
                        'Не удалось изменить статус письма.',
                        () => {
                          setMessage((current) => current ? { ...current, is_read: !wasRead } : current);
                          setThreadStats((current) => current ? {
                            ...current,
                            unread: Math.max(0, current.unread + (wasRead ? 1 : -1)),
                          } : current);
                          if (String(message.folder || folderParam || 'inbox') === 'inbox') {
                            publishNativeMailUnreadDelta(wasRead ? 1 : -1);
                          }
                        },
                      );
                    }}
                  />
                  <ActionRow
                    icon={message.importance === 'high' ? 'alert-circle' : 'alert-circle-outline'}
                    label={message.importance === 'high' ? 'Убрать важность' : 'Пометить важным'}
                    disabled={busy || offlineMode}
                    tokens={tokens}
                    onPress={() => {
                      setFileActionsOpen(false);
                      toggleImportance();
                    }}
                  />
                  {message.folder === 'trash' ? (
                    <ActionRow icon="restore" label="Восстановить" disabled={busy || offlineMode} tokens={tokens} onPress={() => {
                      setFileActionsOpen(false);
                      void mutate(
                        () => restoreMailMessage(message.id, String(message.mailbox_id || mailboxIdParam), message.restore_hint_folder || 'inbox'),
                        'Не удалось восстановить письмо.',
                        () => goBackOrReplace('/(shell)/mail'),
                      );
                    }} />
                  ) : message.can_archive !== false ? (
                    <ActionRow icon="archive-arrow-down-outline" label="Переместить в архив" disabled={busy || offlineMode} tokens={tokens} onPress={() => {
                      setFileActionsOpen(false);
                      void mutate(
                        () => moveMailMessage(message.id, String(message.mailbox_id || mailboxIdParam), 'archive'),
                        'Не удалось архивировать письмо.',
                        () => goBackOrReplace('/(shell)/mail'),
                      );
                    }} />
                  ) : null}
                  {message.can_move !== false && moveTargets.length ? (
                    <ActionRow icon="folder-move-outline" label="Переместить в другую папку" disabled={busy || offlineMode} tokens={tokens} onPress={() => {
                      setFileActionsOpen(false);
                      setMoveOpen(true);
                    }} />
                  ) : null}
                  <ActionRow icon="trash-can-outline" label={message.folder === 'trash' ? 'Удалить навсегда' : 'Удалить'} disabled={busy || offlineMode} danger tokens={tokens} onPress={() => {
                    setFileActionsOpen(false);
                    confirmDelete();
                  }} />
                  <View style={[styles.actionDivider, { backgroundColor: tokens.borderSoft }]} />
                <ActionRow icon="format-list-bulleted" label="Заголовки письма" disabled={headersLoading || offlineMode} tokens={tokens} onPress={() => { void openHeaders(); }} />
                <ActionRow icon="email-fast-outline" label="Поделиться исходником EML" disabled={busy || offlineMode} tokens={tokens} onPress={() => { void shareSource(); }} />
                <ActionRow icon="printer-outline" label="Печать" disabled={busy} tokens={tokens} onPress={() => { void printMessage(); }} />
                </ScrollView>
              </View>
            </View>
          </Modal>
          <Modal visible={headersOpen} transparent animationType="slide" onRequestClose={() => setHeadersOpen(false)}>
            <View style={styles.modalRoot}>
              <Pressable style={styles.backdropDismissLayer} onPress={() => setHeadersOpen(false)} accessibilityRole="button" accessibilityLabel="Закрыть заголовки письма" />
              <View testID="native-mail-headers-sheet" style={[styles.headersSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <View style={styles.moveHeader}>
                  <View style={styles.moveHeaderText}>
                    <Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>Заголовки письма</Text>
                    <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Исходные служебные поля сообщения.</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setHeadersOpen(false)} style={styles.modalClose}>
                    <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
                  </Pressable>
                </View>
                {headersLoading ? <ActivityIndicator style={styles.headersLoading} color={tokens.primary} /> : (
                  <ScrollView style={styles.headersList} contentContainerStyle={styles.headersContent}>
                    {headers.items.length ? headers.items.map((header, index) => (
                      <View key={`${String(header.name || 'header')}-${index}`} style={[styles.headerItem, { borderColor: tokens.borderSoft }]}>
                        <Text selectable style={[styles.headerName, { color: tokens.textSecondary }]}>{String(header.name || 'Header')}</Text>
                        <Text selectable style={[styles.headerValue, { color: tokens.textPrimary }]}>{String(header.value || '')}</Text>
                      </View>
                    )) : <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Заголовки не найдены.</Text>}
                  </ScrollView>
                )}
              </View>
            </View>
          </Modal>
          <Modal visible={moveOpen} transparent animationType="slide" onRequestClose={() => setMoveOpen(false)}>
            <View style={styles.modalRoot}>
              <Pressable style={styles.backdropDismissLayer} onPress={() => setMoveOpen(false)} accessibilityRole="button" accessibilityLabel="Закрыть выбор папки" />
              <View testID="native-mail-move-sheet" style={[styles.moveSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <View style={styles.moveHeader}>
                  <View style={styles.moveHeaderText}>
                    <Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>Переместить письмо</Text>
                    <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Выберите системную или пользовательскую папку.</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setMoveOpen(false)} style={styles.modalClose}>
                    <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
                  </Pressable>
                </View>
                <ScrollView style={styles.moveList} contentContainerStyle={styles.moveListContent}>
                  {moveTargets.map((target) => (
                    <Pressable
                      key={target.id}
                      testID={`native-mail-move-target-${target.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Переместить в папку ${target.pathLabel}`}
                      disabled={busy || offlineMode}
                      onPress={() => {
                        setMoveOpen(false);
                        void mutate(
                          () => moveMailMessage(message.id, String(message.mailbox_id || mailboxIdParam), target.id),
                          'Не удалось переместить письмо.',
                          () => goBackOrReplace('/(shell)/mail'),
                        );
                      }}
                      style={({ pressed }) => [
                        styles.moveTarget,
                        { borderColor: tokens.borderSoft, backgroundColor: pressed ? tokens.panelInset : tokens.panelSolid },
                      ]}
                    >
                      <MaterialCommunityIcons name="folder-outline" size={21} color={tokens.iconMuted} />
                      <View style={styles.moveTargetText}>
                        <Text numberOfLines={2} style={[styles.moveTargetLabel, { color: tokens.textPrimary }]}>{target.pathLabel}</Text>
                        {target.unread ? <Text style={[styles.moveTargetMeta, { color: tokens.textSecondary }]}>{target.unread} непрочитанных</Text> : null}
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      ) : !loading ? <AccountSectionCard tokens={tokens} title="Письмо недоступно" description="Обновите список и повторите попытку.">{null}</AccountSectionCard> : null}
      </ScrollView>
      {message && message.folder !== 'drafts' && !message.draft_context ? (
        <NativeMailQuickReplyBar
          testID="native-mail-message-quick-reply-bar"
          inputTestID="native-mail-message-quick-reply"
          sendTestID="native-mail-message-send-quick-reply"
          value={quickReply}
          busy={quickReplyBusy}
          disabled={offlineMode}
          placeholder="Ответить на письмо…"
          status={quickReplyStatus}
          tokens={tokens}
          onChangeText={(value) => {
            setQuickReply(value);
            setQuickReplyStatus('');
            if (quickReplyKeyRef.current?.fingerprint !== `${message.id}\n${value.trim()}`) quickReplyKeyRef.current = null;
          }}
          onSend={() => { void sendQuickReply(); }}
        />
      ) : null}
      <NativeMailImageViewer
        items={imageViewerItems}
        currentKey={imageViewerKey}
        loading={imageViewerLoading}
        onChange={(key) => { setImageViewerLoading(false); setImageViewerKey(key); }}
        onClose={() => { setImageViewerLoading(false); setImageViewerKey(''); }}
        onOpen={imageViewerItem ? () => { void useAttachment(imageViewerItem.attachment, 'open'); } : undefined}
        onShare={imageViewerItem ? () => { void useAttachment(imageViewerItem.attachment, 'share'); } : undefined}
      />
      {message && message.folder !== 'drafts' && !message.draft_context ? (
        <View
          testID="native-mail-reader-bottom-actions"
          style={[
            styles.bottomActions,
            {
              backgroundColor: tokens.headerBandBg,
              borderTopColor: tokens.borderSoft,
              paddingBottom: Math.max(safeAreaBottom, 8),
            },
          ]}
        >
          <BottomAction testID="native-mail-reply" icon="reply-outline" label="Ответить" tokens={tokens} onPress={() => compose('reply')} />
          <BottomAction testID="native-mail-forward" icon="forward" label="Переслать" tokens={tokens} onPress={() => compose('forward')} />
          <BottomAction
            testID="native-mail-importance"
            icon={message.importance === 'high' ? 'bookmark' : 'bookmark-outline'}
            label="Важное"
            active={message.importance === 'high'}
            disabled={busy || offlineMode}
            tokens={tokens}
            onPress={toggleImportance}
          />
          <BottomAction testID="native-mail-delete" icon="trash-can-outline" label="Удалить" danger disabled={busy || offlineMode} tokens={tokens} onPress={confirmDelete} />
          <BottomAction testID="native-mail-message-file-actions" icon="dots-horizontal" label="Ещё" tokens={tokens} onPress={() => setFileActionsOpen(true)} />
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BottomAction({ testID, icon, label, active, disabled, danger, tokens, onPress }: { testID?: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; active?: boolean; disabled?: boolean; danger?: boolean; tokens: ReturnType<typeof useFluentTokens>; onPress: () => void }) {
  const color = danger ? tokens.error : active ? tokens.primary : tokens.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.bottomAction, { opacity: disabled ? 0.45 : pressed ? 0.62 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={25} color={color} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.bottomActionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ActionRow({ testID, icon, label, disabled, danger, tokens, onPress }: { testID?: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; disabled: boolean; danger?: boolean; tokens: ReturnType<typeof useFluentTokens>; onPress: () => void }) {
  const color = danger ? tokens.error : tokens.textPrimary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionRow, { backgroundColor: pressed ? tokens.panelInset : 'transparent', opacity: disabled ? 0.5 : 1 }]}><MaterialCommunityIcons name={icon} size={21} color={danger ? tokens.error : tokens.iconMuted} /><Text style={[styles.actionText, { color }]}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} /></Pressable>;
}

const styles = StyleSheet.create({
  readerSafe: { flex: 1 },
  readerTopBar: { minHeight: 66, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  readerTopAction: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  readerTopActionDisabled: { opacity: 0.3 },
  readerTopSpacer: { flex: 1 },
  readerMain: { flex: 1 },
  readerScroll: { flex: 1 },
  readerScrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 30 },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: 8, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  subjectBlock: { marginBottom: 26, paddingHorizontal: 4 },
  subject: { fontSize: 29, lineHeight: 36, fontWeight: '600', letterSpacing: -0.4 },
  metaRow: { marginTop: 13, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  threadMetaText: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  unreadDot: { width: 9, height: 9, borderRadius: 5 },
  summaryBlock: { marginTop: 24, alignItems: 'flex-start' },
  summaryButton: { minHeight: 46, borderRadius: 15, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryButtonText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  summaryResult: { width: '100%', marginTop: 10, borderRadius: 14, padding: 14 },
  summaryText: { fontSize: 15, lineHeight: 23 },
  primaryAction: { minHeight: 50, borderRadius: 13, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  bottomActions: { minHeight: 72, paddingTop: 7, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start' },
  bottomAction: { flex: 1, minWidth: 0, minHeight: 57, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 1 },
  bottomActionLabel: { width: '100%', textAlign: 'center', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  actionRow: { minHeight: 48, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionText: { flex: 1, fontSize: 13, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdropDismissLayer: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.48)' },
  moveSheet: { maxHeight: '74%', borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, paddingBottom: 22 },
  actionSheet: { maxHeight: '78%', borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, paddingBottom: 22 },
  headersSheet: { height: '78%', borderTopWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24 },
  moveHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  moveHeaderText: { flex: 1 },
  moveTitle: { fontSize: 19, lineHeight: 25, fontWeight: '900' },
  moveHint: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actionList: { marginTop: 8 },
  actionListContent: { gap: 1, paddingBottom: 4 },
  actionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 7, marginHorizontal: 10 },
  moveList: { marginTop: 10 },
  headersLoading: { marginTop: 32 },
  headersList: { marginTop: 10 },
  headersContent: { gap: 8, paddingBottom: 12 },
  headerItem: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  headerName: { fontSize: 12, lineHeight: 17, fontWeight: '900' },
  headerValue: { marginTop: 3, fontSize: 13, lineHeight: 19 },
  moveListContent: { gap: 7, paddingBottom: 8 },
  moveTarget: { minHeight: 54, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  moveTargetText: { flex: 1, minWidth: 0 },
  moveTargetLabel: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  moveTargetMeta: { marginTop: 2, fontSize: 11 },
});
