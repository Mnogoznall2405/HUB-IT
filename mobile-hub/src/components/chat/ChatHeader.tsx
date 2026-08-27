import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { PresenceAvatar } from './PresenceAvatar';

export function ChatHeader({
  title,
  subtitle,
  avatarUrl,
  muted = false,
  onBack,
  onOpenInfo,
  onSearch,
}: {
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  muted?: boolean;
  onBack?: () => void;
  onOpenInfo?: () => void;
  onSearch?: () => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  return (
    <View style={styles.wrap}>
      <IconButton icon="arrow-left" onPress={onBack || (() => router.back())} accessibilityLabel="Назад к чатам" />
      <Pressable
        onPress={onOpenInfo}
        disabled={!onOpenInfo}
        style={({ pressed }) => [styles.identity, pressed && onOpenInfo ? styles.identityPressed : null]}
        accessibilityRole={onOpenInfo ? 'button' : undefined}
        accessibilityLabel={onOpenInfo ? `Информация о чате ${title}` : undefined}
        accessibilityHint={onOpenInfo ? 'Открывает участников, уведомления и настройки чата' : undefined}
      >
        <PresenceAvatar label={title} avatarUrl={avatarUrl} size={40} />
        <View style={styles.textBlock}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {muted ? <Text style={styles.muted} accessibilityLabel="Уведомления выключены">⌁</Text> : null}
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onSearch ? (
        <IconButton icon="magnify" onPress={onSearch} accessibilityLabel="Поиск в диалоге" />
      ) : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: chatTokens.threadTopbarBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
    paddingRight: 4,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  identityPressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
  textBlock: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { flexShrink: 1, fontSize: 17, fontWeight: '600', color: chatTokens.textPrimary },
  subtitle: { fontSize: 13, color: chatTokens.textSecondary, marginTop: 2 },
  muted: { color: chatTokens.textSecondary, fontSize: 15 },
});
