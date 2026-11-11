import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatConversationSummary } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBottomSheet } from './ChatBottomSheet';

type ConversationAction = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
};

/** F-MUTE-TIMER: null = indefinitely, ISO string = until that moment. */
const MUTE_DURATIONS: Array<{ label: string; until: () => string | null }> = [
  { label: 'На 1 час', until: () => new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  { label: 'На 8 часов', until: () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() },
  { label: 'На 1 неделю', until: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
  { label: 'Навсегда', until: () => null },
];

export function formatMutedUntilLabel(mutedUntil?: string | null): string {
  if (!mutedUntil) return '';
  const date = new Date(mutedUntil);
  if (!Number.isFinite(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return '';
  if (diffMs < 60 * 60 * 1000) return `ещё ${Math.max(1, Math.round(diffMs / 60_000))} мин`;
  if (diffMs < 24 * 60 * 60 * 1000) return `ещё ${Math.round(diffMs / 3_600_000)} ч`;
  return `до ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
}

export function ChatConversationActionsSheet({
  conversation,
  onClose,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
  onFolders,
}: {
  conversation: ChatConversationSummary | null;
  onClose: () => void;
  onTogglePin: (conversation: ChatConversationSummary) => void;
  onToggleMute: (conversation: ChatConversationSummary, mutedUntil?: string | null) => void;
  onToggleArchive: (conversation: ChatConversationSummary) => void;
  onFolders: (conversation: ChatConversationSummary) => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const [mutePicker, setMutePicker] = useState(false);
  if (!conversation) return null;

  if (mutePicker) {
    return (
      <ChatBottomSheet
        visible
        onClose={onClose}
        dismissAccessibilityLabel="Закрыть действия с диалогом"
        sheetStyle={styles.sheet}
      >
        <Text style={styles.title} accessibilityRole="header">
          Выключить уведомления
        </Text>
        <View style={styles.actions}>
          {MUTE_DURATIONS.map((option) => (
            <Pressable
              key={option.label}
              onPress={() => { setMutePicker(false); onToggleMute(conversation, option.until()); }}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={option.label}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="bell-off-outline" size={23} color={chatTokens.accentText} />
              </View>
              <Text style={styles.actionText}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => setMutePicker(false)}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Назад к действиям диалога"
        >
          <Text style={styles.cancelText}>Назад</Text>
        </Pressable>
      </ChatBottomSheet>
    );
  }

  const mutedHint = conversation.is_muted ? formatMutedUntilLabel(conversation.muted_until) : '';
  const actions: ConversationAction[] = [
    {
      icon: conversation.is_pinned ? 'pin-off-outline' : 'pin-outline',
      label: conversation.is_pinned ? 'Открепить' : 'Закрепить',
      onPress: () => onTogglePin(conversation),
    },
    {
      icon: conversation.is_muted ? 'bell-outline' : 'bell-off-outline',
      label: conversation.is_muted
        ? `Включить уведомления${mutedHint ? ` (${mutedHint})` : ''}`
        : 'Выключить уведомления',
      onPress: () => (conversation.is_muted
        ? onToggleMute(conversation)
        : setMutePicker(true)),
    },
    {
      icon: conversation.is_archived ? 'archive-arrow-up-outline' : 'archive-outline',
      label: conversation.is_archived ? 'Вернуть из архива' : 'Архивировать',
      onPress: () => onToggleArchive(conversation),
    },
    {
      icon: 'folder-plus-outline',
      label: 'Добавить в папку',
      onPress: () => onFolders(conversation),
    },
  ];

  return (
    <ChatBottomSheet
      visible
      onClose={onClose}
      dismissAccessibilityLabel="Закрыть действия с диалогом"
      sheetStyle={styles.sheet}
    >
      <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
        {conversation.title || 'Диалог'}
      </Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name={action.icon}
                size={23}
                color={chatTokens.accentText}
              />
            </View>
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Отмена"
      >
        <Text style={styles.cancelText}>Отмена</Text>
      </Pressable>
    </ChatBottomSheet>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  sheet: {
    paddingBottom: 12,
  },
  title: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    color: chatTokens.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  actions: { paddingHorizontal: 8 },
  action: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  iconWrap: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: chatTokens.sidebarRowSoftActive,
  },
  actionText: {
    flex: 1,
    marginLeft: 12,
    color: chatTokens.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  cancelText: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
