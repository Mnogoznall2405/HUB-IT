import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ChatSticker, ChatStickerPack } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { collectRecentStickers } from '../../chat/chatStickers';
import { shouldDismissMediaViewer } from '../../chat/chatGestures';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';
import { ChatStickerImage } from './ChatStickerImage';

export function ChatStickerPickerSheet({
  visible,
  packs,
  recentIds = [],
  loading,
  importing,
  onClose,
  onSend,
  onImport,
  onRemove,
}: {
  visible: boolean;
  packs: ChatStickerPack[];
  recentIds?: string[];
  loading?: boolean;
  importing?: boolean;
  onClose: () => void;
  onSend: (sticker: ChatSticker) => void;
  onImport?: (source: string) => void;
  onRemove?: (pack: ChatStickerPack) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<ChatSticker | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const recent = useMemo(() => collectRecentStickers(packs, recentIds), [packs, recentIds]);

  const close = () => {
    setPreview(null);
    dragY.setValue(0);
    onClose();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: (_, gesture) => !(gesture.dy > 10 && gesture.dy >= Math.abs(gesture.dx)),
    onPanResponderMove: (_, gesture) => {
      if (!reduceMotion && gesture.dy > 0) dragY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_, gesture) => {
      if (shouldDismissMediaViewer(gesture.dx, gesture.dy)) {
        close();
        return;
      }
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => dragY.setValue(0),
  }), [onClose, reduceMotion]);

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      statusBarTranslucent
      onRequestClose={close}
    >
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Скрыть панель стикеров" />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: dragY }] }]}
          accessibilityViewIsModal
        >
          <View style={styles.header} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.titleRow}>
              <Text style={styles.title}>Стикеры</Text>
              <Pressable
                onPress={close}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Закрыть стикеры"
              >
                <Text style={styles.closeText}>Закрыть</Text>
              </Pressable>
            </View>
          </View>
          {onImport ? (
            <View style={styles.importRow}>
              <TextInput
                value={source}
                onChangeText={setSource}
                placeholder="t.me/addstickers/имя или short name"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.importInput}
                accessibilityLabel="Ссылка на набор стикеров"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => {
                  const next = source.trim();
                  if (!next || importing) return;
                  onImport(next);
                  setSource('');
                }}
                disabled={importing || !source.trim()}
                style={({ pressed }) => [
                  styles.importButton,
                  (importing || !source.trim()) && styles.disabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Добавить набор"
              >
                <Text style={styles.importButtonText}>Добавить</Text>
              </Pressable>
            </View>
          ) : null}
          {loading || importing ? <ActivityIndicator color={chatTokens.composerActionBg} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {recent.length ? (
              <StickerSection title="Недавние" stickers={recent} onSend={onSend} onPreview={setPreview} />
            ) : null}
            {packs.map((pack) => (
              <View key={pack.id} style={styles.pack}>
                <View style={styles.packHeader}>
                  <Text style={styles.packTitle}>{pack.title}</Text>
                  {onRemove ? (
                    <Pressable
                      onPress={() => onRemove(pack)}
                      style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить набор ${pack.title}`}
                    >
                      <Text style={styles.removeText}>Удалить</Text>
                    </Pressable>
                  ) : null}
                </View>
                <StickerGrid stickers={pack.stickers} onSend={onSend} onPreview={setPreview} />
              </View>
            ))}
            {!loading && !packs.length ? <Text style={styles.empty}>Добавленных наборов стикеров пока нет</Text> : null}
          </ScrollView>
        </Animated.View>
      {preview ? (
        <View style={styles.preview} pointerEvents="none">
          <ChatStickerImage
            sticker={preview}
            size={220}
            label={`Превью стикера ${preview.emoji || ''}`.trim()}
          />
          {preview.emoji ? <Text style={styles.previewEmoji}>{preview.emoji}</Text> : null}
        </View>
      ) : null}
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

function StickerSection({
  title,
  stickers,
  onSend,
  onPreview,
}: {
  title: string;
  stickers: ChatSticker[];
  onSend: (sticker: ChatSticker) => void;
  onPreview: (sticker: ChatSticker | null) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <View style={styles.pack}>
      <Text style={styles.packTitle}>{title}</Text>
      <StickerGrid stickers={stickers} onSend={onSend} onPreview={onPreview} />
    </View>
  );
}

function StickerGrid({
  stickers,
  onSend,
  onPreview,
}: {
  stickers: ChatSticker[];
  onSend: (sticker: ChatSticker) => void;
  onPreview: (sticker: ChatSticker | null) => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <View style={styles.grid}>
      {stickers.map((sticker) => (
        <Pressable
          key={sticker.id}
          onPress={() => onSend(sticker)}
          onLongPress={() => onPreview(sticker)}
          onPressOut={() => onPreview(null)}
          delayLongPress={220}
          style={({ pressed }) => [styles.sticker, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Отправить стикер ${sticker.emoji || ''}`.trim()}
          accessibilityHint="Удерживайте, чтобы посмотреть крупно"
        >
          <ChatStickerImage sticker={sticker} size={64} />
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: chatTokens.overlayBg },
  sheet: {
    height: '72%',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: chatTokens.panelBg,
  },
  header: { paddingTop: 8, paddingBottom: 4 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: chatTokens.borderSoft },
  titleRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, color: chatTokens.textPrimary, fontSize: 19, fontWeight: '700' },
  close: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  closeText: { color: chatTokens.accentText, fontSize: 16, fontWeight: '700' },
  importRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  importInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
    fontSize: 15,
  },
  importButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: chatTokens.composerActionBg,
  },
  importButtonText: { color: '#fff', fontWeight: '700' },
  scroll: { paddingBottom: 24 },
  pack: { marginBottom: 14 },
  packHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  packTitle: { color: chatTokens.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: chatTokens.dangerText, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  sticker: { width: '25%', minHeight: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  empty: { padding: 22, color: chatTokens.textSecondary, textAlign: 'center' },
  pressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
  disabled: { opacity: 0.45 },
  preview: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  previewEmoji: {
    marginTop: 14,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.36)',
    fontSize: 16,
    fontWeight: '700',
  },
});
