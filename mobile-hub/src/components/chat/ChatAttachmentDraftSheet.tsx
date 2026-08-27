import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { NativePickedFile } from '../../files/nativeFilePicker';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

function fileSizeLabel(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} КБ`;
  return `${Math.max(0, size)} Б`;
}

export function ChatAttachmentDraftSheet({
  visible,
  files,
  caption,
  busy,
  progress,
  error,
  onChangeCaption,
  onRemove,
  onCancel,
  onSend,
}: {
  visible: boolean;
  files: NativePickedFile[];
  caption: string;
  busy: boolean;
  progress?: number | null;
  error?: string;
  onChangeCaption: (value: string) => void;
  onRemove: (index: number) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const progressText = progress == null ? '' : ` ${Math.round(progress * 100)}%`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel="Закрыть предпросмотр вложений"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>{files.length > 1 ? `Выбрано файлов: ${files.length}` : 'Вложение'}</Text>
            <Pressable
              disabled={busy}
              onPress={onCancel}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel="Отменить отправку вложений"
            >
              <Text style={styles.cancelText}>Отмена</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.files}>
            {files.map((file, index) => (
              <View key={`${file.uri}:${index}`} style={styles.fileCard}>
                {file.mimeType.startsWith('image/') ? (
                  <Image source={{ uri: file.uri }} style={styles.preview} resizeMode="cover" accessible={false} />
                ) : (
                  <View style={styles.fileIcon}><Text style={styles.fileIconText}>{file.mimeType.startsWith('video/') ? '▶' : '📎'}</Text></View>
                )}
                <Text numberOfLines={1} style={styles.fileName}>{file.name}</Text>
                <Text style={styles.fileSize}>{fileSizeLabel(file.size)}</Text>
                <Pressable
                  disabled={busy}
                  onPress={() => onRemove(index)}
                  hitSlop={6}
                  style={styles.remove}
                  accessibilityRole="button"
                  accessibilityLabel={`Убрать ${file.name}`}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <TextInput
            value={caption}
            onChangeText={onChangeCaption}
            editable={!busy}
            multiline
            maxLength={12000}
            placeholder="Добавить подпись"
            placeholderTextColor={chatTokens.textSecondary}
            style={styles.caption}
            accessibilityLabel="Подпись к вложениям"
          />
          {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <Pressable
            disabled={busy || !files.length}
            onPress={onSend}
            style={({ pressed }) => [styles.send, pressed && styles.pressed, (busy || !files.length) && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={error ? 'Повторить отправку вложений' : 'Отправить вложения'}
          >
            <Text style={styles.sendText}>{busy ? `Отправляем${progressText}` : error ? 'Повторить' : 'Отправить'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.44)' },
  sheet: {
    maxHeight: '78%',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: chatTokens.panelBg,
  },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: chatTokens.textPrimary, fontSize: 17, fontWeight: '700' },
  headerButton: { minWidth: 48, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  cancelText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '600' },
  files: { gap: 10, paddingVertical: 10 },
  fileCard: { width: 126, position: 'relative' },
  preview: { width: 126, height: 126, borderRadius: 12, backgroundColor: chatTokens.sidebarSearchBg },
  fileIcon: { width: 126, height: 126, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: chatTokens.sidebarSearchBg },
  fileIconText: { fontSize: 32 },
  fileName: { marginTop: 6, color: chatTokens.textPrimary, fontSize: 13, fontWeight: '600' },
  fileSize: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 11 },
  remove: { position: 'absolute', top: 6, right: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
  removeText: { color: '#fff', fontSize: 24, lineHeight: 26 },
  caption: { minHeight: 48, maxHeight: 112, marginTop: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, color: chatTokens.textPrimary, backgroundColor: chatTokens.sidebarSearchBg, fontSize: 15 },
  error: { marginTop: 8, color: chatTokens.dangerText, fontSize: 13 },
  send: { minHeight: 48, marginTop: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: chatTokens.composerActionBg },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});
