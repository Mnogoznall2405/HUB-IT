import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MailAttachment, MailMessageDetail } from '../../api/mailApi';
import { getNativeMailAttachmentImageSource, getNativeMailAttachmentVisual } from '../../mail/nativeMailAttachmentVisual';
import { getVisibleNativeMailAttachments } from '../../mail/nativeMailAttachments';
import { canPreviewMailAttachment } from '../../mail/nativeMailFiles';
import { mailByteLabel, mailDateLabel, mailPreviewSender, mailSubject } from '../../mail/nativeMailModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeMailHtmlBody } from './NativeMailHtmlBody';

export function NativeMailMessageCard({
  message,
  tokens,
  compact = false,
  reader = false,
  readerAccessory,
  busyAttachment,
  onOpenAttachment,
  onShareAttachment,
  onPreviewAttachment,
  onSaveAllAttachments,
}: {
  message: MailMessageDetail;
  tokens: FluentTokens;
  compact?: boolean;
  reader?: boolean;
  readerAccessory?: ReactNode;
  busyAttachment?: string;
  onOpenAttachment?: (attachment: MailAttachment) => void;
  onShareAttachment?: (attachment: MailAttachment) => void;
  onPreviewAttachment?: (attachment: MailAttachment) => void;
  onSaveAllAttachments?: (attachments: MailAttachment[]) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const recipientGroups = useMemo(() => [
    { label: 'Кому', values: mergeRecipientLabels(message.to_people, message.to) },
    { label: 'Копия', values: mergeRecipientLabels(message.cc_people, message.cc) },
    { label: 'Скрытая копия', values: mergeRecipientLabels(message.bcc_people, message.bcc) },
  ].filter((group) => group.values.length), [message.bcc, message.bcc_people, message.cc, message.cc_people, message.to, message.to_people]);
  const recipients = recipientGroups.find((group) => group.label === 'Кому')?.values.slice(0, compact ? 2 : 3).join(', ') || '';
  const sender = mailPreviewSender(message);
  const senderEmail = String(message.sender_person?.email || message.sender_email || message.sender || '').trim();
  const recipientCount = useMemo(() => new Set([
    ...recipientGroups.flatMap((group) => group.values.map((value) => value.toLocaleLowerCase())),
  ].filter(Boolean)).size, [recipientGroups]);
  const attachments = useMemo(() => getVisibleNativeMailAttachments(message), [message]);
  const hasRichBody = Boolean(String(message.body_html || '').trim());
  const showFlatReader = reader && !compact;
  return (
    <View
      testID={showFlatReader ? 'native-mail-reader-content' : undefined}
      style={showFlatReader
        ? styles.reader
        : [styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={[styles.header, showFlatReader ? styles.readerHeader : null]}>
        <View style={[styles.avatar, showFlatReader ? styles.readerAvatar : null, { backgroundColor: message.is_read === false ? tokens.primary : tokens.panelInset }]}>
          <Text style={[styles.avatarText, showFlatReader ? styles.readerAvatarText : null, { color: message.is_read === false ? '#fff' : tokens.textSecondary }]}>
            {sender.slice(0, 1).toUpperCase() || 'П'}
          </Text>
        </View>
        <View style={styles.headerBody}>
          <View style={styles.senderRow}>
            <Text numberOfLines={1} style={[styles.sender, showFlatReader ? styles.readerSender : null, { color: tokens.textPrimary }]}>{sender}</Text>
            {!showFlatReader ? <Text style={[styles.date, { color: tokens.textTertiary }]}>{mailDateLabel(message.received_at)}</Text> : null}
          </View>
          {!showFlatReader && senderEmail && senderEmail.toLocaleLowerCase() !== sender.toLocaleLowerCase() ? (
            <Text numberOfLines={1} style={[styles.senderEmail, { color: tokens.textSecondary }]}>{senderEmail}</Text>
          ) : null}
          <Pressable
            testID={showFlatReader ? 'native-mail-recipient-details' : undefined}
            accessibilityRole="button"
            accessibilityLabel={detailsExpanded ? 'Скрыть сведения об адресатах' : 'Показать сведения об адресатах'}
            accessibilityState={{ expanded: detailsExpanded }}
            onPress={() => setDetailsExpanded((current) => !current)}
            style={[styles.recipientSummary, showFlatReader ? styles.readerRecipientSummary : null]}
          >
            {showFlatReader ? (
              <>
                <Text numberOfLines={1} style={[styles.readerDate, { color: tokens.textSecondary }]}>{mailReaderDateLabel(message.received_at)}</Text>
                <Text accessibilityElementsHidden style={[styles.readerMetaDot, { color: tokens.textTertiary }]}>•</Text>
                <MaterialCommunityIcons name="account-outline" size={17} color={tokens.iconMuted} />
                <Text
                  testID="native-mail-recipient-count"
                  accessibilityLabel={`Получателей: ${recipientCount}`}
                  style={[styles.readerParticipantCount, { color: tokens.textSecondary }]}
                >
                  {recipientCount}
                </Text>
              </>
            ) : (
              <Text numberOfLines={1} style={[styles.recipients, { color: tokens.textSecondary }]}> 
                {recipients ? `Кому: ${recipients}` : 'Получатели не указаны'}
              </Text>
            )}
            <MaterialCommunityIcons name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={tokens.iconMuted} />
          </Pressable>
        </View>
      </View>
      {detailsExpanded ? (
        <View testID="native-mail-recipient-details-expanded" style={[styles.recipientDetails, showFlatReader ? styles.readerRecipientDetails : null, { backgroundColor: tokens.panelInset }]}> 
          {senderEmail ? <View style={styles.recipientDetailRow}>
            <Text style={[styles.recipientDetailLabel, { color: tokens.textTertiary }]}>От кого</Text>
            <Text selectable style={[styles.recipientDetailValue, { color: tokens.textPrimary }]}>{senderEmail}</Text>
          </View> : null}
          {recipientGroups.map((group) => (
            <View key={group.label} style={styles.recipientDetailRow}>
              <Text style={[styles.recipientDetailLabel, { color: tokens.textTertiary }]}>{group.label}</Text>
              <Text selectable style={[styles.recipientDetailValue, { color: tokens.textPrimary }]}>{group.values.join(', ')}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!compact && !reader ? <Text style={[styles.subject, { color: tokens.textPrimary }]}>{mailSubject(message)}</Text> : null}
      <NativeMailAttachmentSection
        attachments={attachments}
        tokens={tokens}
        busyAttachment={busyAttachment}
        onOpenAttachment={onOpenAttachment}
        onShareAttachment={onShareAttachment}
        onPreviewAttachment={onPreviewAttachment}
        onSaveAllAttachments={onSaveAllAttachments}
      />
      {readerAccessory}
      {hasRichBody ? (
        <NativeMailHtmlBody
          key={`${message.mailbox_id || ''}:${message.id}`}
          bodyHtml={String(message.body_html)}
          plainText={message.body_text || message.body_preview}
          attachments={message.attachments}
          compact={compact}
          flat={showFlatReader}
          tokens={tokens}
        />
      ) : (
        <Text testID="native-mail-plain-body" selectable style={[styles.body, showFlatReader ? styles.readerBody : null, { color: tokens.textPrimary }]}>
          {String(message.body_text || message.body_preview || '').trim() || 'В письме нет текстового содержимого.'}
        </Text>
      )}
    </View>
  );
}

function NativeMailAttachmentSection({
  attachments,
  tokens,
  busyAttachment,
  onOpenAttachment,
  onShareAttachment,
  onPreviewAttachment,
  onSaveAllAttachments,
}: {
  attachments: MailAttachment[];
  tokens: FluentTokens;
  busyAttachment?: string;
  onOpenAttachment?: (attachment: MailAttachment) => void;
  onShareAttachment?: (attachment: MailAttachment) => void;
  onPreviewAttachment?: (attachment: MailAttachment) => void;
  onSaveAllAttachments?: (attachments: MailAttachment[]) => void;
}) {
  if (!attachments.length) return null;
  const downloadable = attachments.filter((attachment) => attachment.downloadable !== false);
  const savingAll = busyAttachment === '__all__';
  return (
    <View testID="native-mail-attachments" style={styles.attachments}>
      <View style={styles.attachmentsHeader}>
        <Text style={[styles.attachmentsTitle, { color: tokens.textSecondary }]}>Вложения · {attachments.length}</Text>
        {onSaveAllAttachments ? (
          <Pressable
            testID="native-mail-save-all-attachments"
            accessibilityRole="button"
            accessibilityLabel="Сохранить все вложения"
            accessibilityState={{ disabled: savingAll || !downloadable.length, busy: savingAll }}
            disabled={savingAll || !downloadable.length}
            onPress={() => onSaveAllAttachments(downloadable)}
            style={({ pressed }) => [styles.saveAllAction, pressed ? styles.pressed : null, savingAll || !downloadable.length ? styles.disabled : null]}
          >
            <MaterialCommunityIcons name={savingAll ? 'progress-download' : 'download-multiple'} size={19} color={tokens.primary} />
            <Text style={[styles.saveAllText, { color: tokens.primary }]}>{savingAll ? 'Сохраняю…' : 'Сохранить все'}</Text>
          </Pressable>
        ) : null}
      </View>
      {attachments.map((attachment, index) => {
        const ref = String(attachment.download_token || attachment.id || index);
        const busy = savingAll || busyAttachment === ref;
        const visual = getNativeMailAttachmentVisual(attachment);
        const imageSource = getNativeMailAttachmentImageSource(attachment);
        const sizeLabel = mailByteLabel(attachment.size);
        return (
          <View key={ref} testID={`native-mail-attachment-${index}`} style={[styles.attachmentCard, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelMuted }]}>
            {imageSource ? (
              <Pressable
                testID={`native-mail-attachment-image-${index}`}
                onPress={() => onOpenAttachment?.(attachment)}
                disabled={busy || attachment.downloadable === false}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Просмотреть изображение ${attachment.name || 'без названия'}`}
                accessibilityState={{ disabled: busy || attachment.downloadable === false, busy }}
                style={({ pressed }) => [styles.imagePreviewButton, pressed ? styles.pressed : null]}
              >
                <Image source={{ uri: imageSource }} resizeMode="contain" style={[styles.imagePreview, { backgroundColor: tokens.panelSolid }]} />
              </Pressable>
            ) : null}
            <View style={styles.attachmentRow}>
              <View style={[styles.attachmentIconTile, { backgroundColor: `${visual.color}18` }]}>
                <MaterialCommunityIcons name={visual.icon} size={24} color={visual.color} />
              </View>
              <View style={styles.attachmentText}>
                <Text numberOfLines={2} style={[styles.attachmentName, { color: tokens.textPrimary }]}>{attachment.name || 'Вложение'}</Text>
                <Text style={[styles.attachmentSize, { color: tokens.textTertiary }]}>{sizeLabel ? `${visual.label} · ${sizeLabel}` : visual.label}</Text>
              </View>
            </View>
            <View style={styles.attachmentActions}>
              <Pressable
                onPress={() => onOpenAttachment?.(attachment)}
                disabled={busy || attachment.downloadable === false}
                accessibilityRole="button"
                accessibilityLabel={`Открыть ${visual.label.toLocaleLowerCase()} ${attachment.name || ''}`.trim()}
                accessibilityState={{ disabled: busy || attachment.downloadable === false, busy }}
                style={({ pressed }) => [styles.attachmentAction, pressed ? styles.pressed : null]}
              >
                <MaterialCommunityIcons name={busy ? 'progress-download' : 'open-in-new'} size={20} color={tokens.primary} />
              </Pressable>
              {canPreviewMailAttachment(attachment) && onPreviewAttachment ? (
                <Pressable
                  onPress={() => onPreviewAttachment(attachment)}
                  disabled={busy || attachment.downloadable === false}
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть PDF-предпросмотр ${attachment.name}`}
                  accessibilityState={{ disabled: busy || attachment.downloadable === false, busy }}
                  style={({ pressed }) => [styles.attachmentAction, pressed ? styles.pressed : null]}
                >
                  <MaterialCommunityIcons name="file-eye-outline" size={20} color={tokens.primary} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onShareAttachment?.(attachment)}
                disabled={busy || attachment.downloadable === false}
                accessibilityRole="button"
                accessibilityLabel={`Поделиться ${attachment.name}`}
                accessibilityState={{ disabled: busy || attachment.downloadable === false, busy }}
                style={({ pressed }) => [styles.attachmentAction, pressed ? styles.pressed : null]}
              >
                <MaterialCommunityIcons name="share-variant-outline" size={20} color={tokens.primary} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  reader: { paddingHorizontal: 4 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  readerHeader: { gap: 14, alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  readerAvatar: { width: 54, height: 54, borderRadius: 27 },
  avatarText: { fontSize: 16, fontWeight: '900' },
  readerAvatarText: { fontSize: 22 },
  headerBody: { flex: 1, minWidth: 0 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sender: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  readerSender: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  date: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  senderEmail: { marginTop: 1, fontSize: 12, lineHeight: 17 },
  recipientSummary: { minHeight: 44, marginTop: 1, marginLeft: -6, paddingLeft: 6, flexDirection: 'row', alignItems: 'center' },
  readerRecipientSummary: { alignSelf: 'stretch', flexWrap: 'wrap', gap: 5, marginTop: 1, paddingRight: 6 },
  recipients: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  readerDate: { maxWidth: 190, fontSize: 15, lineHeight: 21 },
  readerMetaDot: { fontSize: 13 },
  readerParticipantCount: { fontSize: 15, lineHeight: 21 },
  recipientDetails: { marginTop: 10, marginLeft: 0, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 7 },
  readerRecipientDetails: { marginLeft: 0, marginTop: 12 },
  recipientDetailRow: { gap: 2 },
  recipientDetailLabel: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  recipientDetailValue: { minWidth: 0, fontSize: 12, lineHeight: 18 },
  subject: { marginTop: 15, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  body: { marginTop: 18, fontSize: 16, lineHeight: 25 },
  readerBody: { marginTop: 28 },
  attachments: { marginTop: 20, gap: 8 },
  attachmentsHeader: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  attachmentsTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  saveAllAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8 },
  saveAllText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  attachmentCard: { overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  imagePreviewButton: { width: '100%' },
  imagePreview: { width: '100%', height: 190 },
  attachmentRow: { minHeight: 58, paddingHorizontal: 10, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentIconTile: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  attachmentText: { flex: 1, minWidth: 0 },
  attachmentName: { fontSize: 13, fontWeight: '800' },
  attachmentSize: { marginTop: 2, fontSize: 11 },
  attachmentActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', paddingHorizontal: 6, gap: 8 },
  attachmentAction: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.84 },
  disabled: { opacity: 0.48 },
});

function mailReaderDateLabel(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function mergeRecipientLabels(
  people: MailMessageDetail['to_people'] | MailMessageDetail['cc_people'] | MailMessageDetail['bcc_people'],
  fallback: string[] | undefined,
): string[] {
  const labels = new Map<string, string>();
  (people || []).forEach((person) => {
    const display = String(person.display || person.name || '').trim();
    const email = String(person.email || '').trim();
    const value = display && email && display.toLocaleLowerCase() !== email.toLocaleLowerCase()
      ? `${display} <${email}>`
      : display || email;
    if (value) labels.set(recipientIdentity(email || value), value);
  });
  (fallback || []).forEach((item) => {
    const value = String(item || '').trim();
    const identity = recipientIdentity(value);
    if (value && !labels.has(identity)) labels.set(identity, value);
  });
  return [...labels.values()];
}

function recipientIdentity(value: unknown): string {
  const text = String(value || '').trim();
  const email = text.match(/<([^<>]+)>/)?.[1] || text;
  return email.trim().toLocaleLowerCase();
}
