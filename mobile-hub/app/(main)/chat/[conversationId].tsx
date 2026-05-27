import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, IconButton } from 'react-native-paper';
import { useAuth } from '../../../src/auth/AuthContext';
import * as chatApi from '../../../src/api/chatApi';
import { formatApiError } from '../../../src/api/formatError';
import type { ChatConversationSummary, ChatMessage } from '../../../src/api/types';
import { ChatBubble } from '../../../src/components/chat/ChatBubble';
import { ChatComposer } from '../../../src/components/chat/ChatComposer';
import { ChatHeader } from '../../../src/components/chat/ChatHeader';
import { chatSocket } from '../../../src/chat/chatSocket';
import { chatTokens } from '../../../src/theme/chatTokens';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export default function ConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationTitle, setConversationTitle] = useState('Чат');
  const [text, setText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const markedReadRef = useRef(false);

  const convId = String(conversationId || '');

  const mapMessages = useCallback(
    (data: ChatMessage[]) =>
      data.map((item) => ({
        ...item,
        is_own: item.sender_user_id === user?.id,
      })),
    [user?.id],
  );

  const loadMessages = useCallback(async () => {
    if (!convId) return;
    const data = await chatApi.getMessages(convId);
    setMessages(mapMessages(data));
    const last = data[data.length - 1];
    if (last?.id && !markedReadRef.current) {
      markedReadRef.current = true;
      chatApi.markConversationRead(convId, last.id).catch(() => {});
    }
  }, [convId, mapMessages]);

  const appendMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, { ...message, is_own: message.sender_user_id === user?.id }];
      });
    },
    [user?.id],
  );

  useEffect(() => {
    markedReadRef.current = false;
    if (!convId) return;
    loadMessages();
    chatApi.getConversation(convId).then((c) => setConversationTitle(c.title || 'Чат')).catch(() => {});
    chatSocket.subscribeConversation(convId);
    const offCreated = chatSocket.on('chat.message.created', (envelope: unknown) => {
      const body = envelope as { payload?: { conversation_id?: string; message?: ChatMessage } };
      const cid = String(body?.payload?.conversation_id || body?.payload?.message?.conversation_id || '');
      if (cid === convId && body?.payload?.message) appendMessage(body.payload.message);
      else if (cid === convId) loadMessages();
    });
    const offReaction = chatSocket.on('chat.message.reaction', (envelope: unknown) => {
      const body = envelope as { payload?: { conversation_id?: string } };
      if (String(body?.payload?.conversation_id || '') === convId) loadMessages();
    });
    return () => {
      offCreated();
      offReaction();
      chatSocket.unsubscribeConversation(convId);
    };
  }, [convId, loadMessages, appendMessage]);

  const sendMessage = async () => {
    const body = text.trim();
    if (!body || !convId) return;
    setText('');
    try {
      const msg = await chatApi.sendTextMessage(convId, body);
      appendMessage(msg);
    } catch (e: unknown) {
      Alert.alert('Ошибка', formatApiError(e));
      setText(body);
    }
  };

  const pickAttachment = async (mode: 'image' | 'document') => {
    if (!convId) return;
    try {
      let formData: FormData | null = null;
      if (mode === 'image') {
        const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85 });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        formData = new FormData();
        formData.append('file', {
          uri: asset.uri,
          name: asset.fileName || 'photo.jpg',
          type: asset.mimeType || 'image/jpeg',
        } as unknown as Blob);
      } else {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        formData = new FormData();
        formData.append('file', {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
        } as unknown as Blob);
      }
      if (formData) {
        const msg = await chatApi.sendFileMessage(convId, formData);
        appendMessage(msg);
      }
    } catch (e: unknown) {
      Alert.alert('Ошибка', formatApiError(e, 'Не удалось отправить файл'));
    }
  };

  const runSearch = async () => {
    if (!convId || !searchQuery.trim()) return;
    const results = await chatApi.searchMessages(convId, searchQuery.trim());
    setSearchResults(mapMessages(results));
  };

  const openForward = async (message: ChatMessage) => {
    setForwardMessage(message);
    const list = await chatApi.getConversations();
    setConversations(list.filter((item) => item.id !== convId));
    setForwardOpen(true);
  };

  const doForward = async (targetId: string) => {
    if (!forwardMessage) return;
    await chatApi.forwardMessage(targetId, forwardMessage.id);
    setForwardOpen(false);
    setForwardMessage(null);
    Alert.alert('Готово', 'Сообщение переслано');
  };

  const toggleReaction = async (emoji: string) => {
    if (!reactionTarget || !convId) return;
    await chatApi.toggleReaction(convId, reactionTarget.id, emoji);
    setReactionTarget(null);
    await loadMessages();
  };

  const onMessageAction = (item: ChatMessage) => {
    Alert.alert('Сообщение', undefined, [
      { text: 'Реакция', onPress: () => setReactionTarget(item) },
      { text: 'Переслать', onPress: () => openForward(item) },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          if (!convId) return;
          await chatApi.deleteMessage(convId, item.id);
          setMessages((prev) => prev.filter((m) => m.id !== item.id));
        },
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ChatHeader title={conversationTitle} subtitle="HUB-IT Chat" />
      <View style={styles.toolbar}>
        <IconButton icon="magnify" onPress={() => setSearchOpen((v) => !v)} />
        <IconButton icon="paperclip" onPress={() => pickAttachment('document')} />
        <IconButton icon="image" onPress={() => pickAttachment('image')} />
      </View>
      {searchOpen ? (
        <View style={styles.searchBar}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Поиск по сообщениям"
            style={styles.searchInput}
            placeholderTextColor={chatTokens.textSecondary}
          />
          <Button mode="contained" onPress={runSearch} compact>
            Найти
          </Button>
        </View>
      ) : null}
      <FlatList
        data={searchOpen && searchResults.length ? searchResults : messages}
        keyExtractor={(item) => item.id}
        inverted
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ChatBubble
            message={item}
            isOwn={Boolean(item.is_own ?? item.sender_user_id === user?.id)}
            onLongPress={() => onMessageAction(item)}
          />
        )}
      />
      <ChatComposer value={text} onChangeText={setText} onSend={sendMessage} />

      <Modal visible={Boolean(reactionTarget)} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setReactionTarget(null)}>
          <View style={styles.reactionRow}>
            {REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => toggleReaction(emoji)} style={styles.reactionBtn}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={forwardOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.forwardCard}>
            <Text style={styles.forwardTitle}>Переслать в...</Text>
            {conversations.map((item) => (
              <Pressable key={item.id} onPress={() => doForward(item.id)} style={styles.forwardRow}>
                <Text>{item.title || item.id}</Text>
              </Pressable>
            ))}
            <Button onPress={() => setForwardOpen(false)}>Отмена</Button>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatTokens.threadBg },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: chatTokens.threadTopbarBg },
  searchBar: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    backgroundColor: chatTokens.composerDockBg,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: chatTokens.borderSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: chatTokens.composerInputBg,
    color: chatTokens.textPrimary,
  },
  list: { paddingHorizontal: 12, paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: chatTokens.panelBg,
    borderRadius: 16,
    padding: 12,
    alignSelf: 'center',
  },
  reactionBtn: { padding: 6 },
  reactionEmoji: { fontSize: 28 },
  forwardCard: { backgroundColor: chatTokens.panelBg, borderRadius: 12, padding: 16, maxHeight: '60%' },
  forwardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: chatTokens.textPrimary },
  forwardRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
  },
});
