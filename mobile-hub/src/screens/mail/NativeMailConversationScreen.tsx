import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getMailConversation,
  sendMailMessage,
  setMailConversationRead,
  type MailAttachment,
  type MailConversationDetail,
  type MailMessageDetail,
} from '../../api/mailApi';
import { formatApiError } from '../../api/formatError';
import { getNativeMailPreferences } from '../../api/mailConfigApi';
import { useAuth } from '../../auth/AuthContext';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
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
import { downloadMailAttachment, downloadMailAttachmentPreviewPdf } from '../../mail/nativeMailFiles';
import { nativeMailComposeDestination } from '../../mail/nativeMailFeature';
import { buildNativeMailOutgoingHtml, composeVariantForMode, mailSubject } from '../../mail/nativeMailModel';
import { publishNativeMailUnreadDelta } from '../../mail/nativeMailUnreadEvents';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function quickReplyIdempotencyKey(): string {
  return Crypto.randomUUID?.()
    || `mail-quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function NativeMailConversationScreen() {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; mailboxId?: string | string[]; folder?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const mailboxId = first(params.mailboxId);
  const folder = first(params.folder) || 'inbox';
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('mail.access');
  const [conversation, setConversation] = useState<MailConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState(0);
  const [error, setError] = useState('');
  const [busyAttachment, setBusyAttachment] = useState('');
  const [readStateBusy, setReadStateBusy] = useState(false);
  const [quickReply, setQuickReply] = useState('');
  const [quickReplyBusy, setQuickReplyBusy] = useState(false);
  const [imageViewerKey, setImageViewerKey] = useState('');
  const [imageViewerLoading, setImageViewerLoading] = useState(false);
  const quickReplyKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const snapshotKey = `${mailboxId}:${folder}:${conversationId}`;

  const load = useCallback(async () => {
    if (!allowed || !conversationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const cached = user?.id
      ? await readNativeEntitySnapshot<MailConversationDetail>(
        'mail-conversation-details',
        user.id,
        snapshotKey,
        Number.MAX_SAFE_INTEGER,
      )
      : null;
    if (cached) {
      setConversation(cached.data);
      setCachedAt(cached.savedAt);
      setLoading(false);
    }
    if (offlineMode) {
      if (!cached) {
        setConversation(null);
        setCachedAt(0);
        setError('Нет подключения и сохранённой копии переписки. Откройте её один раз при наличии сети.');
      }
      setLoading(false);
      return;
    }
    try {
      const [detail, viewPreferences] = await Promise.all([
        getMailConversation(conversationId, { mailboxId, folder, folderScope: 'current' }),
        getNativeMailPreferences().catch(() => null),
      ]);
      setConversation(detail);
      setCachedAt(0);
      if (Number(detail.unread_count || 0) > 0 && viewPreferences?.mark_read_on_select === true && !offlineMode) {
        setConversation((current) => current ? { ...current, unread_count: 0, items: current.items.map((item) => ({ ...item, is_read: true })) } : current);
        void setMailConversationRead(conversationId, true, { mailboxId, folder, folderScope: 'current' }).then((result) => {
          if (result.ok === false || Number(result.failed || 0) > 0) {
            throw new Error('Exchange не применил статус ко всем письмам переписки');
          }
          if (folder === 'inbox') publishNativeMailUnreadDelta(-Math.max(0, Number(detail.unread_count || 0)));
        }).catch(() => {
          setConversation((current) => current?.conversation_id === detail.conversation_id ? detail : current);
          setError('Переписка открылась, но не отметилась прочитанной.');
        });
      }
    } catch (cause) {
      setError(formatApiError(cause, cached
        ? 'Показана сохранённая копия. Не удалось обновить переписку.'
        : 'Не удалось открыть переписку.'));
    } finally {
      setLoading(false);
    }
  }, [allowed, conversationId, folder, mailboxId, offlineMode, snapshotKey, user?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!conversation || offlineMode || !user?.id) return;
    void writeNativeEntitySnapshot('mail-conversation-details', user.id, snapshotKey, conversation);
  }, [conversation, offlineMode, snapshotKey, user?.id]);

  const imageViewerItems = useMemo(() => buildNativeMailImageGallery(conversation?.items || []), [conversation]);
  const imageViewerItem = imageViewerItems.find((item) => item.key === imageViewerKey) || null;
  const imageViewerMessage = imageViewerItem
    ? conversation?.items.find((item) => item.id === imageViewerItem.messageId) || null
    : null;

  useEffect(() => {
    if (offlineMode || !conversation || !imageViewerItem || imageViewerItem.uri) return undefined;
    let active = true;
    setImageViewerLoading(true);
    void downloadMailAttachment(
      imageViewerItem.messageId,
      imageViewerItem.mailboxId || mailboxId,
      imageViewerItem.attachment,
    ).then((file) => {
      if (!active) return;
      setImageViewerLoading(false);
      setConversation((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === imageViewerItem.messageId
          ? withNativeMailAttachmentPreview(item, imageViewerItem.attachment, file.uri)
          : item),
      } : current);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить изображение.'));
    }).finally(() => {
      if (active) setImageViewerLoading(false);
    });
    return () => { active = false; };
  }, [conversation, imageViewerItem?.key, imageViewerItem?.uri, mailboxId, offlineMode]);

  const latest = conversation?.items?.[conversation.items.length - 1] || null;
  const compose = useCallback((mode: 'reply' | 'reply_all' | 'forward') => {
    if (!latest) return;
    router.push(nativeMailComposeDestination({
      mode,
      mailboxId: latest.mailbox_id || mailboxId,
      sourceMessageId: latest.id,
    }) as never);
  }, [latest, mailboxId]);

  const useAttachment = useCallback(async (message: MailMessageDetail, attachment: MailAttachment, action: 'open' | 'share' | 'preview') => {
    if (busyAttachment) return;
    const ref = `${message.id}:${String(attachment.download_token || attachment.id || 'file')}`;
    setBusyAttachment(ref);
    setError('');
    try {
      const scopedMailboxId = String(message.mailbox_id || mailboxId);
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
  }, [busyAttachment, mailboxId]);

  const saveAllAttachments = useCallback(async (message: MailMessageDetail, attachments: MailAttachment[]) => {
    if (busyAttachment || offlineMode) return;
    setBusyAttachment(`${message.id}:__all__`);
    setError('');
    try {
      const result = await saveNativeMailAttachmentsToDirectory(
        message.id,
        String(message.mailbox_id || mailboxId),
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
  }, [busyAttachment, mailboxId, offlineMode]);

  const openAttachment = useCallback((message: MailMessageDetail, attachment: MailAttachment) => {
    if (getNativeMailAttachmentKind(attachment) === 'image') {
      const key = `${message.id}:${nativeMailAttachmentReference(attachment, '')}`;
      if (imageViewerItems.some((item) => item.key === key)) setImageViewerKey(key);
      return;
    }
    void useAttachment(message, attachment, 'open');
  }, [imageViewerItems, useAttachment]);

  const webPath = useCallback(() => {
    const query = new URLSearchParams({ conversation: conversationId, folder });
    if (mailboxId) query.set('mailbox_id', mailboxId);
    return `/mail?${query.toString()}`;
  }, [conversationId, folder, mailboxId]);

  const toggleReadState = useCallback(async () => {
    if (!conversation || readStateBusy || offlineMode) return;
    const markRead = Number(conversation.unread_count || 0) > 0;
    setReadStateBusy(true);
    setError('');
    try {
      const result = await setMailConversationRead(conversationId, markRead, { mailboxId, folder, folderScope: 'current' });
      if (result.ok === false || Number(result.failed || 0) > 0) {
        throw new Error('Exchange не применил статус ко всем письмам переписки');
      }
      setConversation((current) => current ? {
        ...current,
        unread_count: markRead ? 0 : Math.max(1, Number(current.messages_count || current.items.length || 1)),
        items: current.items.map((item) => ({ ...item, is_read: markRead })),
      } : current);
      if (folder === 'inbox') {
        const previousUnread = Math.max(0, Number(conversation.unread_count || 0));
        const nextUnread = markRead ? 0 : Math.max(1, Number(conversation.messages_count || conversation.items.length || 1));
        publishNativeMailUnreadDelta(nextUnread - previousUnread);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить статус переписки.'));
    } finally {
      setReadStateBusy(false);
    }
  }, [conversation, conversationId, folder, mailboxId, offlineMode, readStateBusy]);

  const sendQuickReply = useCallback(async () => {
    const body = quickReply.trim();
    if (!latest || !body || quickReplyBusy || offlineMode) return;
    const { variant, quoteHtml } = composeVariantForMode(latest, 'reply');
    const to = (variant.to || []).map(String).filter(Boolean);
    const fallbackRecipient = String(latest.sender_email || latest.sender || '').trim();
    if (!to.length && fallbackRecipient) to.push(fallbackRecipient);
    if (!to.length) {
      setError('Не удалось определить получателя быстрого ответа. Откройте полный редактор.');
      return;
    }
    const fingerprint = `${latest.id}\n${body}`;
    if (quickReplyKeyRef.current?.fingerprint !== fingerprint) {
      quickReplyKeyRef.current = { fingerprint, key: quickReplyIdempotencyKey() };
    }
    setQuickReplyBusy(true);
    setError('');
    try {
      await sendMailMessage({
        fromMailboxId: String(latest.compose_context?.mailbox_id || latest.mailbox_id || mailboxId),
        composeMode: 'reply',
        to,
        cc: (variant.cc || []).map(String).filter(Boolean),
        subject: String(variant.subject || latest.subject || ''),
        body: buildNativeMailOutgoingHtml(body, quoteHtml),
        isHtml: true,
        replyToMessageId: latest.id,
      }, { idempotencyKey: quickReplyKeyRef.current.key });
      quickReplyKeyRef.current = null;
      setQuickReply('');
      await load();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить быстрый ответ. Повторная попытка будет безопасной.'));
    } finally {
      setQuickReplyBusy(false);
    }
  }, [latest, load, mailboxId, offlineMode, quickReply, quickReplyBusy]);

  if (!allowed) {
    return <AccountScreenScaffold title="Переписка" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <AccountScreenScaffold
      title={conversation ? mailSubject(conversation) : 'Переписка'}
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/mail')}
      scroll={false}
    >
      <KeyboardAvoidingView
        testID="native-mail-conversation-keyboard-host"
        style={styles.screen}
        {...chatKeyboardAvoidingProps()}
      >
      <ScrollView
        testID="native-mail-conversation-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} tintColor={tokens.primary} />}
      >
      {loading && !conversation ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {offlineMode ? (
        <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>
          Автономный режим: статусы и отправка недоступны.{cachedAt ? ` Копия от ${formatNativeSnapshotSavedAt(cachedAt)}.` : ''}
        </Text>
      ) : null}
      {conversation ? (
        <>
          <View style={styles.summary}>
            <Text style={[styles.summaryTitle, { color: tokens.textPrimary }]}>{mailSubject(conversation)}</Text>
            <Text style={[styles.summaryMeta, { color: tokens.textSecondary }]}>{conversation.messages_count || conversation.items.length} сообщений · {(conversation.participants || []).length} участников</Text>
          </View>
          <View style={styles.messages}>
            {conversation.items.map((message, index) => {
              const attachmentPrefix = `${message.id}:`;
              const cardBusy = busyAttachment.startsWith(attachmentPrefix) ? busyAttachment.slice(attachmentPrefix.length) : '';
              return (
                <NativeMailMessageCard
                  key={message.id || index}
                  message={message}
                  tokens={tokens}
                  compact
                  busyAttachment={cardBusy}
                  onOpenAttachment={(attachment) => openAttachment(message, attachment)}
                  onShareAttachment={(attachment) => { void useAttachment(message, attachment, 'share'); }}
                  onPreviewAttachment={(attachment) => { void useAttachment(message, attachment, 'preview'); }}
                  onSaveAllAttachments={(attachments) => { void saveAllAttachments(message, attachments); }}
                />
              );
            })}
          </View>
          <Pressable
            testID="native-mail-conversation-toggle-read"
            accessibilityRole="button"
            accessibilityLabel={Number(conversation.unread_count || 0) > 0 ? 'Отметить переписку прочитанной' : 'Отметить переписку непрочитанной'}
            accessibilityState={{ disabled: readStateBusy || offlineMode, busy: readStateBusy }}
            disabled={readStateBusy || offlineMode}
            onPress={() => { void toggleReadState(); }}
            style={[styles.readStateAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid, opacity: readStateBusy || offlineMode ? 0.5 : 1 }]}
          >
            {readStateBusy ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name={Number(conversation.unread_count || 0) > 0 ? 'email-open-outline' : 'email-outline'} size={20} color={tokens.primary} />}
            <Text style={[styles.readStateText, { color: tokens.primary }]}>{Number(conversation.unread_count || 0) > 0 ? 'Отметить прочитанной' : 'Отметить непрочитанной'}</Text>
          </Pressable>
          {latest ? (
            <>
              <View style={styles.replyRow}>
                <ReplyAction icon="reply-outline" label="Ответить" tokens={tokens} onPress={() => compose('reply')} />
                <ReplyAction icon="reply-all-outline" label="Всем" tokens={tokens} onPress={() => compose('reply_all')} />
                <ReplyAction icon="forward" label="Переслать" tokens={tokens} onPress={() => compose('forward')} />
              </View>
            </>
          ) : null}
        </>
      ) : !loading ? <AccountSectionCard tokens={tokens} title="Переписка недоступна" description="Обновите почту и повторите попытку.">{null}</AccountSectionCard> : null}
      </ScrollView>
      {latest ? (
        <NativeMailQuickReplyBar
          testID="native-mail-quick-reply-bar"
          inputTestID="native-mail-quick-reply"
          sendTestID="native-mail-send-quick-reply"
          value={quickReply}
          busy={quickReplyBusy}
          disabled={offlineMode}
          placeholder="Ответить на последнее письмо…"
          tokens={tokens}
          onChangeText={(value) => {
            setQuickReply(value);
            if (quickReplyKeyRef.current?.fingerprint !== `${latest.id}\n${value.trim()}`) quickReplyKeyRef.current = null;
          }}
          onSend={() => { void sendQuickReply(); }}
        />
      ) : null}
      </KeyboardAvoidingView>
      <NativeMailImageViewer
        items={imageViewerItems}
        currentKey={imageViewerKey}
        loading={imageViewerLoading}
        onChange={(key) => { setImageViewerLoading(false); setImageViewerKey(key); }}
        onClose={() => { setImageViewerLoading(false); setImageViewerKey(''); }}
        onOpen={imageViewerItem && imageViewerMessage ? () => { void useAttachment(
          imageViewerMessage,
          imageViewerItem.attachment,
          'open',
        ); } : undefined}
        onShare={imageViewerItem && imageViewerMessage ? () => { void useAttachment(
          imageViewerMessage,
          imageViewerItem.attachment,
          'share',
        ); } : undefined}
      />
    </AccountScreenScaffold>
  );
}

function ReplyAction({ icon, label, tokens, onPress }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; tokens: ReturnType<typeof useFluentTokens>; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.replyAction, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, opacity: pressed ? 0.75 : 1 }]}><MaterialCommunityIcons name={icon} size={21} color={tokens.primary} /><Text style={[styles.replyText, { color: tokens.primary }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 12 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: 8, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  summary: { marginBottom: 12 },
  summaryTitle: { fontSize: 22, lineHeight: 28, fontWeight: '900' },
  summaryMeta: { marginTop: 4, fontSize: 12, fontWeight: '700' },
  messages: { gap: 10 },
  readStateAction: { minHeight: 48, marginTop: 10, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  readStateText: { fontSize: 12, fontWeight: '900' },
  replyRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  replyAction: { flex: 1, minHeight: 60, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 3 },
  replyText: { fontSize: 11, fontWeight: '800' },
});
