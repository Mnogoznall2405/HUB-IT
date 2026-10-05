import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, FlatList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import type { ChatSticker, ChatStickerPack } from '../../api/types';
import { filterEmojiGroups } from '../../chat/chatEmoji';
import { buildEmojiPickerRows, type EmojiPickerRow } from '../../chat/chatPickerRows';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatInlineSheet } from './ChatInlineSheet';
import { ChatStickerPickerContent } from './ChatStickerPickerContent';

// Header + composer + a few messages that must stay visible above the panel.
const KEYBOARD_TOP_RESERVE = 200;

export type ChatEmojiPickerTab = 'emoji' | 'stickers';

/**
 * One panel for emoji and stickers (Telegram-style tabs). Emoji taps append to
 * the draft and keep the panel open so several can be picked in a row.
 */
export function ChatEmojiPickerSheet({
  visible,
  tab,
  onChangeTab,
  onClose,
  onSelect,
  stickerPacks,
  recentStickerIds,
  stickersLoading,
  stickerImporting,
  onSendSticker,
  onImportStickerPack,
  onRemoveStickerPack,
}: {
  visible: boolean;
  tab: ChatEmojiPickerTab;
  onChangeTab: (tab: ChatEmojiPickerTab) => void;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  stickerPacks: ChatStickerPack[];
  recentStickerIds?: string[];
  stickersLoading?: boolean;
  stickerImporting?: boolean;
  onSendSticker: (sticker: ChatSticker) => void;
  onImportStickerPack?: (source: string) => void;
  onRemoveStickerPack?: (pack: ChatStickerPack) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const [emojiQuery, setEmojiQuery] = useState('');
  const keyboard = useKeyboardState();
  const { height: windowHeight } = useWindowDimensions();
  // The panel rides above the open keyboard (search / sticker link input): keep
  // it short enough that the composer and a few messages stay visible.
  const panelHeight = keyboard.isVisible
    ? Math.max(220, Math.min(windowHeight * 0.62, windowHeight - keyboard.height - KEYBOARD_TOP_RESERVE))
    : windowHeight * 0.62;
  const groups = useMemo(() => filterEmojiGroups(emojiQuery), [emojiQuery]);
  const emojiRows = useMemo(() => buildEmojiPickerRows(groups), [groups]);

  useEffect(() => {
    if (!visible) setEmojiQuery('');
  }, [visible]);

  const renderEmojiRow = useCallback(({ item }: { item: EmojiPickerRow }) => {
    if (item.kind === 'header') return <Text style={styles.groupTitle}>{item.title}</Text>;
    return (
      <View style={styles.grid}>
        {item.emojis.map((emoji) => (
          <Pressable
            key={`${item.id}-${emoji}`}
            onPress={() => onSelect(emoji)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Вставить ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
    );
  }, [onSelect, styles]);

  return (
    <ChatInlineSheet
      visible={visible}
      onClose={onClose}
      dismissAccessibilityLabel="Закрыть эмодзи и стикеры"
      sheetStyle={[styles.sheet, { height: panelHeight }]}
      contentStyle={styles.content}
    >
      <View style={styles.tabs}>
        <Pressable
          onPress={() => onChangeTab('emoji')}
          style={[styles.tab, tab === 'emoji' && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'emoji' }}
          accessibilityLabel="Эмодзи"
        >
          <Text style={[styles.tabText, tab === 'emoji' && styles.tabTextActive]}>Эмодзи</Text>
        </Pressable>
        <Pressable
          onPress={() => onChangeTab('stickers')}
          style={[styles.tab, tab === 'stickers' && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'stickers' }}
          accessibilityLabel="Стикеры"
        >
          <Text style={[styles.tabText, tab === 'stickers' && styles.tabTextActive]}>Стикеры</Text>
        </Pressable>
        <View style={styles.tabsSpacer} />
        <Pressable
          onPress={onClose}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Закрыть панель эмодзи и стикеров"
        >
          <Text style={styles.closeText}>Закрыть</Text>
        </Pressable>
      </View>
      {tab === 'stickers' ? (
        <ChatStickerPickerContent
          packs={stickerPacks}
          recentIds={recentStickerIds}
          loading={stickersLoading}
          importing={stickerImporting}
          onSend={onSendSticker}
          onImport={onImportStickerPack}
          onRemove={onRemoveStickerPack}
        />
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
          <FlatList
            key="emoji-grid"
            testID="chat-emoji-picker-list"
            data={emojiRows}
            keyExtractor={(item) => item.id}
            renderItem={renderEmojiRow}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            updateCellsBatchingPeriod={32}
            windowSize={5}
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Эмодзи не найдены</Text>}
          />
        </>
      )}
    </ChatInlineSheet>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  // Fixed height (set from the window): the panel must not jump when switching tabs or filtering.
  sheet: {},
  content: { flex: 1, paddingHorizontal: 14, paddingBottom: 6 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tabsSpacer: { flex: 1 },
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
  close: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 6 },
  closeText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  search: {
    minHeight: 44,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
    fontSize: 16,
  },
  groupTitle: { marginTop: 6, marginBottom: 4, color: chatTokens.textSecondary, fontSize: 13, fontWeight: '700' },
  // nowrap: eight 12.5% cells can overflow by a rounding pixel and push the
  // last emoji of every row onto a line of its own.
  grid: { flexDirection: 'row' },
  list: { flex: 1 },
  empty: { width: '100%', textAlign: 'center', color: chatTokens.textSecondary, marginTop: 16 },
  button: { width: '12.5%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  emoji: { fontSize: 28 },
  pressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
});
