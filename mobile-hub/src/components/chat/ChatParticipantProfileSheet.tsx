import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatMember, ChatUserSummary } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { formatChatPresenceText, isChatPresenceOnline } from '../../chat/chatTyping';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { PresenceAvatar } from './PresenceAvatar';

function roleLabel(role?: string): string {
  if (role === 'owner') return 'Владелец';
  if (role === 'moderator') return 'Модератор';
  return 'Участник';
}

export function ChatPersonProfileFields({
  user,
  role,
  isGroup = false,
}: {
  user?: ChatUserSummary | null;
  role?: string;
  isGroup?: boolean;
}) {
  return (
    <View>
      <ProfileLine label="Должность" value={user?.job_title} empty="Не указана" />
      <ProfileLine label="Подразделение" value={user?.department} empty="Не указано" />
      <ProfileLine label="Город" value={user?.city} empty="Не указан" />
      <ProfileLine label="Корпоративная почта" value={user?.corporate_email} empty="Не указана" />
      <ProfileLine label="Корпоративный телефон" value={user?.corporate_phone} empty="Не указан" />
      {isGroup ? <ProfileLine label="Роль в группе" value={roleLabel(role)} /> : null}
    </View>
  );
}

export function ChatParticipantProfileSheet({
  visible,
  member,
  isGroup = false,
  onClose,
}: {
  visible: boolean;
  member: ChatMember | null;
  isGroup?: boolean;
  onClose: () => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const user = member?.user;
  const title = user?.full_name || user?.username || 'Пользователь';

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть карточку участника"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel="Закрыть профиль"
            >
              <MaterialCommunityIcons name="close" size={22} color={chatTokens.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.hero}>
              <PresenceAvatar
                label={title}
                avatarUrl={user?.avatar_url}
                size={72}
                online={isChatPresenceOnline(user?.presence)}
              />
              <Text style={styles.name}>{title}</Text>
              {user?.username ? <Text style={styles.username}>@{user.username}</Text> : null}
              <Text style={styles.presence}>{formatChatPresenceText(user?.presence)}</Text>
            </View>
            <View style={styles.card}>
              <ChatPersonProfileFields user={user} role={member?.member_role} isGroup={isGroup} />
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.done, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
            >
              <Text style={styles.doneText}>Закрыть</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProfileLine({ label, value, empty }: { label: string; value?: string | null; empty?: string }) {
  const { styles } = useChatStyles(createStyles);
  const text = String(value || '').trim() || empty || '';
  if (!text) return null;
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue} selectable>{text}</Text>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 18, backgroundColor: chatTokens.overlayBg },
  sheet: {
    maxHeight: '86%',
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: chatTokens.panelBg,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
  },
  headerTitle: { flex: 1, color: chatTokens.textPrimary, fontSize: 17, fontWeight: '800' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 20 },
  hero: { alignItems: 'center', paddingBottom: 16 },
  name: { marginTop: 10, color: chatTokens.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  username: { marginTop: 3, color: chatTokens.textSecondary, fontSize: 14 },
  presence: { marginTop: 4, color: chatTokens.textSecondary, fontSize: 14, textAlign: 'center' },
  card: { overflow: 'hidden', borderRadius: 16, backgroundColor: chatTokens.sidebarSearchBg },
  line: { paddingHorizontal: 14, paddingVertical: 11 },
  lineLabel: { color: chatTokens.textSecondary, fontSize: 12 },
  lineValue: { marginTop: 2, color: chatTokens.textPrimary, fontSize: 15, fontWeight: '600' },
  done: {
    marginTop: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  doneText: { color: chatTokens.accentText, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
