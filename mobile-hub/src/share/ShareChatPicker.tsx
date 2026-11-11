import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as chatApi from '../api/chatApi';
import type { ChatConversationSummary } from '../api/types';
import { isRegularSidebarConversation } from '../chat/chatFolders';
import { readNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import { PresenceAvatar } from '../components/chat/PresenceAvatar';
import { officeTokens } from '../theme/officeTokens';

function byPinnedThenRecent(left: ChatConversationSummary, right: ChatConversationSummary): number {
  const pinned = Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned));
  if (pinned) return pinned;
  return new Date(right.last_message_at || 0).getTime() - new Date(left.last_message_at || 0).getTime();
}

/** Pure list logic: regular, non-archived chats that match the query, pinned and recent first. */
export function filterShareTargets(
  items: ChatConversationSummary[],
  query: string,
): ChatConversationSummary[] {
  const needle = query.trim().toLowerCase();
  return items
    .filter((item) => isRegularSidebarConversation(item) && !item.is_archived)
    .filter((item) => !needle || String(item.title || '').toLowerCase().includes(needle))
    .sort(byPinnedThenRecent);
}

/**
 * "Where to send": the user's chats, from the offline cache at once and refreshed
 * from the server. Picking a row hands the conversation back to the share dialog.
 */
export function ShareChatPicker({
  userId,
  onPick,
}: {
  userId: number;
  onPick: (conversation: ChatConversationSummary) => void;
}) {
  const [items, setItems] = useState<ChatConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (userId > 0) {
        const cached = await readNativeChatInboxSnapshot(userId).catch(() => null);
        if (active && cached?.data.items.length) {
          setItems(cached.data.items);
          setLoading(false);
        }
      }
      try {
        const page = await chatApi.getConversationPage({ limit: 50 });
        if (!active) return;
        setItems(page.items);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userId]);

  const rows = useMemo(() => filterShareTargets(items, query), [items, query]);

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <MaterialCommunityIcons name="magnify" size={20} color={officeTokens.textSecondary} />
        <TextInput
          testID="share-chat-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск чата"
          placeholderTextColor={officeTokens.textSecondary}
          accessibilityLabel="Поиск чата"
          style={styles.searchInput}
        />
      </View>
      {loading && !rows.length ? (
        <ActivityIndicator style={styles.loader} color={officeTokens.brand} />
      ) : (
        <FlatList
          testID="share-chat-list"
          data={rows}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              testID={`share-chat-${item.id}`}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Отправить в чат ${item.title || 'без названия'}`}
            >
              <PresenceAvatar label={item.title || '?'} avatarUrl={item.avatar_url} size={40} />
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>{item.title || `Диалог ${item.id}`}</Text>
                {item.last_message_preview ? (
                  <Text style={styles.preview} numberOfLines={1}>{item.last_message_preview}</Text>
                ) : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={(
            <Text style={styles.empty}>
              {failed && !items.length ? 'Не удалось загрузить чаты. Проверьте соединение.' : 'Чаты не найдены.'}
            </Text>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: officeTokens.pageBg,
  },
  searchInput: { flex: 1, color: officeTokens.textPrimary, fontSize: 15, paddingVertical: 8 },
  list: { maxHeight: 360 },
  loader: { paddingVertical: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1 },
  title: { color: officeTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  preview: { color: officeTokens.textSecondary, fontSize: 13, marginTop: 1 },
  empty: { textAlign: 'center', color: officeTokens.textSecondary, fontSize: 14, paddingVertical: 24 },
});
