import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import type { ChatSocketStatus } from '../../chat/chatSocket';
import { useHubConnectionPresentation } from '../layout/HubConnectionHeader';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { PresenceAvatar } from './PresenceAvatar';

// Telegram shows the connection state for ~1s before it replaces the title,
// so a brief reconnect blip never flashes in the header.
const CONNECTION_STATUS_DELAY_MS = 1_000;

export function ChatHeader({
  title,
  subtitle,
  avatarUrl,
  muted = false,
  onBack,
  onOpenInfo,
  onSearch,
  socketStatus,
  subtitleExtra,
}: {
  title: string;
  subtitle?: string;
  subtitleExtra?: ReactNode;
  avatarUrl?: string | null;
  muted?: boolean;
  onBack?: () => void;
  onOpenInfo?: () => void;
  onSearch?: () => void;
  socketStatus?: ChatSocketStatus;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const presentation = useHubConnectionPresentation();
  const socketDown = socketStatus !== undefined && socketStatus !== 'connected';
  const connectionDown = presentation.kind !== 'online' || socketDown;
  const [statusVisible, setStatusVisible] = useState(false);
  useEffect(() => {
    if (!connectionDown) {
      setStatusVisible(false);
      return;
    }
    const timer = setTimeout(() => setStatusVisible(true), CONNECTION_STATUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [connectionDown]);
  const connectionTitle = presentation.kind === 'offline'
    ? 'Ожидание сети…'
    : socketDown || presentation.kind === 'connecting'
      ? 'Соединение…'
      : 'Обновление…';

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
              {statusVisible ? connectionTitle : title}
            </Text>
            {muted ? (
              <MaterialCommunityIcons
                name="bell-off-outline"
                size={15}
                color={chatTokens.textSecondary}
                accessibilityLabel="Уведомления выключены"
              />
            ) : null}
          </View>
          {subtitle ? (
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
              {subtitleExtra}
            </View>
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
  subtitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  subtitle: { fontSize: 13, lineHeight: 16, color: chatTokens.textSecondary },
  muted: { color: chatTokens.textSecondary, fontSize: 15 },
});
