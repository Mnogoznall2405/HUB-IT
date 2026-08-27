import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { filterEmojiGroups } from '../../chat/chatEmoji';
import { fetchChatGifs, type ChatGifItem } from '../../chat/chatGiphy';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

export function ChatEmojiPickerSheet({
  visible,
  onClose,
  onSelect,
  onSelectGif,
  onOpenStickers,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  onSelectGif?: (gif: ChatGifItem) => void;
  onOpenStickers?: () => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<'emoji' | 'gif'>('emoji');
  const [emojiQuery, setEmojiQuery] = useState('');
  const [gifQuery, setGifQuery] = useState('');
  const [gifs, setGifs] = useState<ChatGifItem[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const groups = useMemo(() => filterEmojiGroups(emojiQuery), [emojiQuery]);

  useEffect(() => {
    if (!visible) {
      setTab('emoji');
      setEmojiQuery('');
      setGifQuery('');
      return;
    }
    if (tab !== 'gif' || !onSelectGif) return undefined;
    const request = gifQuery.trim();
    setGifBusy(true);
    const timer = setTimeout(() => {
      void fetchChatGifs(request ? 'search' : 'trending', request)
        .then((items) => setGifs(items))
        .catch(() => setGifs([]))
        .finally(() => setGifBusy(false));
    }, request ? 280 : 0);
    return () => clearTimeout(timer);
  }, [gifQuery, onSelectGif, tab, visible]);

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть эмодзи" />
        <View style={[styles.sheet, (tab === 'gif' || emojiQuery) && styles.sheetTall]} accessibilityViewIsModal>
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab('emoji')}
              style={[styles.tab, tab === 'emoji' && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'emoji' }}
              accessibilityLabel="Эмодзи"
            >
              <Text style={[styles.tabText, tab === 'emoji' && styles.tabTextActive]}>Эмодзи</Text>
            </Pressable>
            {onOpenStickers ? (
              <Pressable
                onPress={onOpenStickers}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityLabel="Стикеры"
              >
                <Text style={styles.tabText}>Стикеры</Text>
              </Pressable>
            ) : null}
            {onSelectGif ? (
              <Pressable
                onPress={() => setTab('gif')}
                style={[styles.tab, tab === 'gif' && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === 'gif' }}
                accessibilityLabel="GIF"
              >
                <Text style={[styles.tabText, tab === 'gif' && styles.tabTextActive]}>GIF</Text>
              </Pressable>
            ) : null}
          </View>
          {tab === 'gif' && onSelectGif ? (
            <>
              <TextInput
                value={gifQuery}
                onChangeText={setGifQuery}
                placeholder="Поиск GIF"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.search}
                accessibilityLabel="Поиск GIF"
              />
              {gifBusy ? (
                <ActivityIndicator style={styles.loader} color={chatTokens.composerActionBg} />
              ) : (
                <ScrollView contentContainerStyle={styles.gifGrid}>
                  {gifs.map((gif) => (
                    <Pressable
                      key={gif.id}
                      onPress={() => onSelectGif(gif)}
                      style={({ pressed }) => [styles.gifButton, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Отправить GIF ${gif.title || gif.id}`}
                    >
                      <Image source={{ uri: gif.previewUrl }} style={styles.gif} />
                    </Pressable>
                  ))}
                  {!gifs.length ? <Text style={styles.empty}>GIF не найдены</Text> : null}
                </ScrollView>
              )}
            </>
          ) : (
            <>
              <TextInput
                value={emojiQuery}
                onChangeText={setEmojiQuery}
                placeholder="Поиск эмодзи"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.search}
                accessibilityLabel="Поиск эмодзи"
              />
              <ScrollView>
                {groups.map((group) => (
                  <View key={group.id} style={styles.group}>
                    <Text style={styles.groupTitle}>{group.icon} {group.name}</Text>
                    <View style={styles.grid}>
                      {group.emojis.map((emoji) => (
                        <Pressable
                          key={`${group.id}-${emoji}`}
                          onPress={() => onSelect(emoji)}
                          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Вставить ${emoji}`}
                        >
                          <Text style={styles.emoji}>{emoji}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
                {!groups.length ? <Text style={styles.empty}>Эмодзи не найдены</Text> : null}
              </ScrollView>
            </>
          )}
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  sheet: { maxHeight: '62%', padding: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: chatTokens.panelBg },
  sheetTall: { maxHeight: '72%' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  tabActive: { backgroundColor: chatTokens.composerActionBg },
  tabText: { color: chatTokens.textSecondary, fontSize: 14, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  search: {
    minHeight: 44,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
    fontSize: 16,
  },
  loader: { marginVertical: 24 },
  group: { marginBottom: 10 },
  groupTitle: { marginBottom: 4, color: chatTokens.textSecondary, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gifGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gifButton: { width: '31%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  gif: { width: '100%', height: '100%' },
  empty: { width: '100%', textAlign: 'center', color: chatTokens.textSecondary, marginTop: 16 },
  button: { width: '12.5%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  emoji: { fontSize: 28 },
  pressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
});
