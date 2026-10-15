import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal as Modal } from '../ui/NativeModal';

// Снимок с камеры перед загрузкой в карточку: можно повернуть, переснять или отправить.
export const NativePhotoRotatePreviewModal = memo(function NativePhotoRotatePreviewModal({
  uri,
  busy,
  tokens,
  onRotate,
  onCancel,
  onConfirm,
}: {
  uri: string | null;
  busy: boolean;
  tokens: FluentTokens;
  onRotate: (degrees: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={Boolean(uri)} animationType="fade" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.body}>
          {uri ? <Image source={{ uri }} style={styles.image} contentFit="contain" recyclingKey={uri} /> : null}
          {busy ? <View style={styles.busy}><ActivityIndicator color="#fff" /></View> : null}
        </View>
        <View style={styles.bar}>
          <Pressable
            testID="native-photo-rotate-left"
            accessibilityRole="button"
            accessibilityLabel="Повернуть снимок влево"
            disabled={busy}
            onPress={() => onRotate(-90)}
            style={styles.iconButton}
          >
            <MaterialCommunityIcons name="rotate-left" size={26} color="#fff" />
          </Pressable>
          <Pressable
            testID="native-photo-rotate-right"
            accessibilityRole="button"
            accessibilityLabel="Повернуть снимок вправо"
            disabled={busy}
            onPress={() => onRotate(90)}
            style={styles.iconButton}
          >
            <MaterialCommunityIcons name="rotate-right" size={26} color="#fff" />
          </Pressable>
          <View style={styles.spacer} />
          <Pressable
            testID="native-photo-rotate-cancel"
            accessibilityRole="button"
            accessibilityLabel="Не загружать снимок"
            disabled={busy}
            onPress={onCancel}
            style={styles.textButton}
          >
            <Text style={styles.textButtonLabel}>Отмена</Text>
          </Pressable>
          <Pressable
            testID="native-photo-rotate-confirm"
            accessibilityRole="button"
            accessibilityLabel="Загрузить снимок"
            disabled={busy}
            onPress={onConfirm}
            style={[styles.confirm, { backgroundColor: tokens.primary, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={styles.confirmLabel}>Загрузить</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  busy: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 24 },
  iconButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  spacer: { flex: 1 },
  textButton: { minHeight: 46, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: '#fff', fontSize: 14, fontWeight: '800' },
  confirm: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
