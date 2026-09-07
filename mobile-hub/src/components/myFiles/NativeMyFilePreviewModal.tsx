import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

export type NativeMyFilePreviewState = {
  kind: 'image' | 'text';
  fileName: string;
  imageUri?: string;
  text?: string;
} | null;

export function NativeMyFilePreviewModal({
  preview,
  tokens,
  onClose,
}: {
  preview: NativeMyFilePreviewState;
  tokens: FluentTokens;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={Boolean(preview)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.72)' }]}
        accessibilityViewIsModal
      >
        <View style={[styles.dialog, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <View style={styles.header}>
            <View style={styles.titleBody}>
              <Text style={[styles.eyebrow, { color: tokens.textSecondary }]}>Безопасный предпросмотр</Text>
              <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{preview?.fileName || 'Файл'}</Text>
            </View>
            <Pressable
              testID="native-my-file-preview-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть предпросмотр"
              style={({ pressed }) => [styles.close, { backgroundColor: tokens.panelInset, opacity: pressed ? 0.72 : 1 }]}
            >
              <MaterialCommunityIcons name="close" size={22} color={tokens.textPrimary} />
            </Pressable>
          </View>

          {preview?.kind === 'image' && preview.imageUri ? (
            <View style={[styles.imageStage, { backgroundColor: tokens.panelInset }]}>
              <Image
                testID="native-my-file-preview-image"
                source={{ uri: preview.imageUri }}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel={`Предпросмотр файла ${preview.fileName}`}
                style={styles.image}
              />
            </View>
          ) : null}

          {preview?.kind === 'text' ? (
            <ScrollView
              testID="native-my-file-preview-text"
              style={[styles.textScroll, { backgroundColor: tokens.panelInset }]}
              contentContainerStyle={styles.textContent}
            >
              <Text selectable style={[styles.code, { color: tokens.textPrimary }]}>{preview.text || 'Файл пуст.'}</Text>
            </ScrollView>
          ) : null}

          <Text style={[styles.securityNote, { color: tokens.textTertiary }]}>
            Содержимое показано без выполнения HTML, JavaScript и внешних ресурсов.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 16, paddingVertical: 28, justifyContent: 'center' },
  dialog: { maxHeight: '92%', borderRadius: 20, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleBody: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  title: { marginTop: 2, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  imageStage: { minHeight: 260, maxHeight: 560, borderRadius: 13, overflow: 'hidden' },
  image: { width: '100%', height: '100%', minHeight: 260 },
  textScroll: { minHeight: 220, maxHeight: 560, borderRadius: 13 },
  textContent: { padding: 14 },
  code: { fontSize: 13, lineHeight: 19, fontFamily: 'monospace' },
  securityNote: { fontSize: 11, lineHeight: 15 },
});
