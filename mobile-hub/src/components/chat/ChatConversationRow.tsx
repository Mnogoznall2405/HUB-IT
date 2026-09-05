import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { conversationKindLabel, shouldShowConversationKindChip } from '../../chat/chatFolders';
import { stripChatMarkdownPreview } from '../../chat/chatMarkdown';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { formatShortTime } from '../../utils/formatTime';
import { PresenceAvatar } from './PresenceAvatar';

export const ChatConversationRow = React.memo(function ChatConversationRow({
  item,
  active,
  onPress,
  onLongPress,
}: {
  item: ChatConversationSummary;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const chatTokens = useChatTokens();
  const styles = React.useMemo(() => createStyles(chatTokens), [chatTokens]);
  const title = item.title || `Диалог ${item.id}`;
  const preview = stripChatMarkdownPreview(item.last_message_preview) || item.last_message_preview || 'Нет сообщений';
  const unread = Number(item.unread_count || 0);
  const time = formatShortTime(item.last_message_at);
  const kindLabel = shouldShowConversationKindChip(item.kind) ? conversationKindLabel(item.kind) : '';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={[styles.row, active && { backgroundColor: chatTokens.sidebarRowActive }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${kindLabel ? `. ${kindLabel}` : ''}. ${preview}${unread ? `. Непрочитанных: ${unread}` : ''}`}
      accessibilityState={{ selected: Boolean(active) }}
    >
      <PresenceAvatar label={title} avatarUrl={item.avatar_url} size={52} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.title, active && styles.titleActive]} numberOfLines={1}>
            {title}
          </Text>
          {kindLabel ? (
            <View style={[styles.kind, active && styles.kindActive]}>
              <Text style={[styles.kindText, active && styles.kindTextActive]}>{kindLabel}</Text>
            </View>
          ) : null}
          {time ? (
            <Text style={[styles.time, active && styles.timeActive]}>{time}</Text>
          ) : null}
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.preview, active && styles.previewActive]} numberOfLines={1}>
            {preview}
          </Text>
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  body: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, flexGrow: 1, fontSize: 16, fontWeight: '600', color: chatTokens.textPrimary },
  titleActive: { color: '#fff' },
  kind: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  kindActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  kindText: { color: chatTokens.accentText, fontSize: 11, fontWeight: '700' },
  kindTextActive: { color: '#fff' },
  time: { fontSize: 12, color: chatTokens.textSecondary },
  timeActive: { color: 'rgba(255,255,255,0.75)' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  preview: { flex: 1, fontSize: 14, color: chatTokens.textSecondary },
  previewActive: { color: 'rgba(255,255,255,0.82)' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: chatTokens.composerActionBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
