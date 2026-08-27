import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MailConversationPreview, MailMessagePreview } from '../../api/mailApi';
import { mailDateLabel, mailPreviewSender, mailSubject, type NativeMailSwipeAction } from '../../mail/nativeMailModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeMailSwipeRow } from './NativeMailSwipeRow';

type MessageRowProps = {
  item: MailMessagePreview;
  selected: boolean;
  selectionMode: boolean;
  tokens: FluentTokens;
  showPreview: boolean;
  compact: boolean;
  canDelete: boolean;
  actionsDisabled: boolean;
  onOpen: (item: MailMessagePreview) => void;
  onToggleSelected: (messageId: string) => void;
  onAction: (item: MailMessagePreview, action: Exclude<NativeMailSwipeAction, null>) => void;
};

export const NativeMailInboxMessageRow = memo(function NativeMailInboxMessageRow({
  item,
  selected,
  selectionMode,
  tokens,
  showPreview,
  compact,
  canDelete,
  actionsDisabled,
  onOpen,
  onToggleSelected,
  onAction,
}: MessageRowProps) {
  const sender = mailPreviewSender(item);
  const subject = mailSubject(item);
  const unread = item.is_read === false;
  const activate = () => selectionMode ? onToggleSelected(item.id) : onOpen(item);
  return (
    <NativeMailSwipeRow
      isRead={!unread}
      canDelete={canDelete}
      disabled={actionsDisabled || selectionMode}
      tokens={tokens}
      onAction={(action) => onAction(item, action)}
    >
      <Pressable
        testID={`native-mail-message-${item.id}`}
        onPress={activate}
        onLongPress={() => onToggleSelected(item.id)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${unread ? 'Непрочитанное. ' : ''}${sender}. ${subject}. ${mailDateLabel(item.received_at)}`}
        accessibilityHint={selectionMode ? 'Нажмите, чтобы изменить выбор' : 'Удерживайте, чтобы выбрать письмо'}
        accessibilityActions={[
          { name: 'longpress', label: selected ? 'Снять выбор письма' : 'Выбрать письмо' },
          { name: 'toggleRead', label: unread ? 'Отметить прочитанным' : 'Отметить непрочитанным' },
          ...(canDelete ? [{ name: 'delete', label: 'Удалить письмо' }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') onToggleSelected(item.id);
          if (event.nativeEvent.actionName === 'toggleRead') onAction(item, 'toggle-read');
          if (event.nativeEvent.actionName === 'delete') onAction(item, 'delete');
        }}
        android_ripple={{ color: tokens.actionHover }}
        style={() => [
          styles.row,
          compact && styles.rowCompact,
          { backgroundColor: tokens.panelSolid },
        ]}
      >
        {selected || unread ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: selected ? tokens.selected : tokens.accentSoft }]}
          />
        ) : null}
        <View style={[styles.avatar, { backgroundColor: unread ? tokens.primary : tokens.panelInset }]}> 
          {selected ? (
            <MaterialCommunityIcons name="check" size={21} color="#fff" />
          ) : (
            <Text maxFontSizeMultiplier={1.25} style={[styles.avatarText, { color: unread ? '#fff' : tokens.textSecondary }]}>
              {sender.slice(0, 1).toUpperCase() || 'П'}
            </Text>
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.topLine}>
            <View style={styles.senderLine}>
              {unread ? <View accessibilityLabel="Непрочитанное" style={[styles.unreadDot, { backgroundColor: tokens.primary }]} /> : null}
              <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.sender, { color: tokens.textPrimary, fontWeight: unread ? '800' : '600' }]}>{sender}</Text>
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.date, { color: unread ? tokens.primary : tokens.textTertiary }]}>{mailDateLabel(item.received_at)}</Text>
          </View>
          <View style={styles.subjectLine}>
            {item.importance === 'high' ? <MaterialCommunityIcons name="alert-circle" size={14} color={tokens.error} /> : null}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.subject, { color: tokens.textPrimary, fontWeight: unread ? '700' : '500' }]}>{subject}</Text>
            {item.has_attachments ? <MaterialCommunityIcons accessibilityLabel="Есть вложения" name="paperclip" size={15} color={tokens.iconMuted} /> : null}
          </View>
          {showPreview ? <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.preview, { color: tokens.textSecondary }]}>{String(item.body_preview || 'Без текста')}</Text> : null}
        </View>
      </Pressable>
    </NativeMailSwipeRow>
  );
});

export const NativeMailInboxConversationRow = memo(function NativeMailInboxConversationRow({
  item,
  tokens,
  showPreview,
  compact,
  onOpen,
}: {
  item: MailConversationPreview;
  tokens: FluentTokens;
  showPreview: boolean;
  compact: boolean;
  onOpen: (item: MailConversationPreview) => void;
}) {
  const unread = Number(item.unread_count || 0);
  const participants = (item.participant_people || []).map((person) => person.display || person.name || person.email).filter(Boolean);
  const people = [...participants, ...(item.participants || []).filter(Boolean)].slice(0, 3).join(', ') || 'Переписка';
  return (
    <Pressable
      testID={`native-mail-conversation-${item.conversation_id}`}
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? `Непрочитанных: ${unread}. ` : ''}${mailSubject(item)}. Сообщений: ${item.messages_count || 0}`}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, { backgroundColor: unread ? tokens.accentSoft : tokens.panelSolid, opacity: pressed ? 0.78 : 1 }]}
    >
      <View style={[styles.avatar, { backgroundColor: unread ? tokens.primary : tokens.panelInset }]}>
        <MaterialCommunityIcons name="email-multiple-outline" size={20} color={unread ? '#fff' : tokens.iconMuted} />
      </View>
      <View style={styles.body}>
        <View style={styles.topLine}>
          <View style={styles.senderLine}>
            {unread ? <View accessibilityLabel="Есть непрочитанные" style={[styles.unreadDot, { backgroundColor: tokens.primary }]} /> : null}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.sender, { color: tokens.textPrimary, fontWeight: unread ? '800' : '600' }]}>{people}</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={[styles.date, { color: unread ? tokens.primary : tokens.textTertiary }]}>{mailDateLabel(item.last_received_at)}</Text>
        </View>
        <View style={styles.subjectLine}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.subject, { color: tokens.textPrimary, fontWeight: unread ? '700' : '500' }]}>{mailSubject(item)}</Text>
          <Text style={[styles.count, { color: tokens.textTertiary }]}>{item.messages_count || 0}</Text>
          {item.has_attachments ? <MaterialCommunityIcons accessibilityLabel="Есть вложения" name="paperclip" size={15} color={tokens.iconMuted} /> : null}
        </View>
        {showPreview ? <Text numberOfLines={1} maxFontSizeMultiplier={1.35} style={[styles.preview, { color: tokens.textSecondary }]}>{String(item.preview || 'Без текста')}</Text> : null}
      </View>
    </Pressable>
  );
});

export function NativeMailInboxDivider({ tokens }: { tokens: FluentTokens }) {
  return <View style={[styles.divider, { backgroundColor: tokens.borderSoft }]} />;
}

const styles = StyleSheet.create({
  row: { minHeight: 92, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowCompact: { minHeight: 84, paddingVertical: 8 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 16, fontWeight: '800' },
  body: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  senderLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  sender: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
  date: { width: 64, flexShrink: 0, textAlign: 'right', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  subjectLine: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  subject: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19 },
  preview: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  count: { fontSize: 11, lineHeight: 16, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 70 },
});
