import { DrawerActions, useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import * as chatApi from '../../../src/api/chatApi';
import { formatApiError } from '../../../src/api/formatError';
import type { ChatConversationSummary } from '../../../src/api/types';
import { ChatConversationRow } from '../../../src/components/chat/ChatConversationRow';
import { ChatFilterBar, type ChatFilter } from '../../../src/components/chat/ChatFilterBar';
import { NewChatSheet } from '../../../src/components/chat/NewChatSheet';
import { chatSocket } from '../../../src/chat/chatSocket';
import { chatTokens } from '../../../src/theme/chatTokens';

export default function ChatListScreen() {
  const navigation = useNavigation();
  const [items, setItems] = useState<ChatConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [search, setSearch] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [users, setUsers] = useState<Array<{ id: number; username: string; full_name?: string }>>([]);
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const conversations = await chatApi.getConversations();
      setItems(conversations);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    chatSocket.subscribeInbox();
    chatSocket.connect();
    const offUpdated = chatSocket.on('chat.conversation.updated', () => load());
    const offMessage = chatSocket.on('chat.message.created', () => load());
    return () => {
      offUpdated();
      offMessage();
    };
  }, [load]);

  const filtered = useMemo(() => {
    let list = [...items];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((item) => {
        const title = String(item.title || '').toLowerCase();
        const preview = String(item.last_message_preview || '').toLowerCase();
        return title.includes(q) || preview.includes(q);
      });
    }
    if (filter === 'unread') list = list.filter((item) => Number(item.unread_count || 0) > 0);
    if (filter === 'direct') list = list.filter((item) => !item.is_group);
    if (filter === 'group') list = list.filter((item) => item.is_group);
    list.sort((a, b) => {
      const ta = new Date(a.last_message_at || 0).getTime();
      const tb = new Date(b.last_message_at || 0).getTime();
      return tb - ta;
    });
    return list;
  }, [items, filter, search]);

  const openNewChat = async () => {
    try {
      const [chatUsers, aiBots] = await Promise.all([chatApi.getChatUsers(), chatApi.getAiBots()]);
      setUsers(chatUsers);
      setBots(aiBots);
      setNewChatOpen(true);
    } catch (e: unknown) {
      Alert.alert('Ошибка', formatApiError(e, 'Не удалось загрузить пользователей'));
    }
  };

  const goConversation = (id: string) => router.push(`/(main)/chat/${id}`);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <IconButton icon="menu" onPress={() => navigation.dispatch(DrawerActions.openDrawer())} />
        <Text style={styles.headerTitle}>Chat</Text>
        <IconButton icon="message-plus" onPress={openNewChat} iconColor={chatTokens.composerActionBg} />
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск чатов"
          placeholderTextColor={chatTokens.textSecondary}
          style={styles.search}
        />
      </View>
      <ChatFilterBar value={filter} onChange={setFilter} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <ChatConversationRow item={item} onPress={() => goConversation(item.id)} />
        )}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Нет диалогов</Text> : null}
      />
      <NewChatSheet
        visible={newChatOpen}
        users={users}
        bots={bots}
        onClose={() => setNewChatOpen(false)}
        onDirect={async (userId) => {
          try {
            const c = await chatApi.createDirectConversation(userId);
            setNewChatOpen(false);
            goConversation(c.id);
          } catch (e: unknown) {
            Alert.alert('Ошибка', formatApiError(e));
          }
        }}
        onGroup={async (title, memberIds) => {
          try {
            const c = await chatApi.createGroupConversation(title, memberIds);
            setNewChatOpen(false);
            goConversation(c.id);
          } catch (e: unknown) {
            Alert.alert('Ошибка', formatApiError(e));
          }
        }}
        onBot={async (botId) => {
          try {
            const c = await chatApi.openAiBot(botId);
            setNewChatOpen(false);
            goConversation(c.id);
          } catch (e: unknown) {
            Alert.alert('Ошибка', formatApiError(e));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatTokens.sidebarBg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: chatTokens.textPrimary },
  searchWrap: { paddingHorizontal: 12, paddingVertical: 8 },
  search: {
    backgroundColor: chatTokens.sidebarSearchBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: chatTokens.textPrimary,
  },
  empty: { textAlign: 'center', marginTop: 48, color: chatTokens.textSecondary, fontSize: 15 },
});
