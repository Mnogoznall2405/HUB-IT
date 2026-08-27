import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatUserSummary } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function getTrailingMentionQuery(value: string): string | null {
  const match = String(value || '').match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  return match ? match[1].toLowerCase() : null;
}

export function replaceTrailingMention(value: string, username: string): string {
  return String(value || '').replace(/@([\p{L}\p{N}_.-]*)$/u, `@${username} `);
}

export function ChatMentionSuggestions({ users, query, onSelect }: {
  users: ChatUserSummary[];
  query: string;
  onSelect: (user: ChatUserSummary) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const filtered = users.filter((user) => {
    const search = `${user.username} ${user.full_name || ''}`.toLowerCase();
    return !query || search.includes(query);
  }).slice(0, 8);
  if (!filtered.length) return null;
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <ScrollView keyboardShouldPersistTaps="always" style={styles.list}>
        {filtered.map((user) => (
          <Pressable
            key={user.id}
            onPress={() => onSelect(user)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Упомянуть ${user.full_name || user.username}`}
          >
            <Text style={styles.name}>{user.full_name || user.username}</Text>
            <Text style={styles.username}>@{user.username}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { maxHeight: 230, paddingHorizontal: 8, paddingTop: 6, backgroundColor: chatTokens.threadBg },
  list: { borderRadius: 16, backgroundColor: chatTokens.panelBg, elevation: 5 },
  row: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14 },
  name: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: '600' },
  username: { marginTop: 1, color: chatTokens.textSecondary, fontSize: 12 },
  pressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
});
