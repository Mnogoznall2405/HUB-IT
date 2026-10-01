import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { parseInventoryQrPayload, type InventoryQrPayload } from '../../database/nativeDatabaseModel';
import { NativeToastHost } from '../nativeToast';
import type { FluentTokens } from '../../theme/fluentTokens';

const SAME_CODE_DELAY_MS = 1_500;
const STREAM_ERROR_HIDE_MS = 2_500;

export function NativeDatabaseQrScannerModal({
  visible,
  tokens,
  onClose,
  onScanned,
  continuous = false,
  overlay,
}: {
  visible: boolean;
  tokens: FluentTokens;
  onClose: () => void;
  onScanned: (payload: InventoryQrPayload) => void;
  continuous?: boolean;
  overlay?: ReactNode;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const scanTimesRef = useRef(new Map<string, number>());
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setScanned(false);
      setError('');
      scanTimesRef.current.clear();
    }
  }, [visible]);

  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  const handleBarcode = useCallback((result: BarcodeScanningResult) => {
    const now = Date.now();
    const lastAt = scanTimesRef.current.get(result.data);
    scanTimesRef.current.set(result.data, now);
    if (scanTimesRef.current.size > 64) {
      for (const [data, at] of scanTimesRef.current) {
        if (now - at > 30_000) scanTimesRef.current.delete(data);
      }
    }
    if (lastAt !== undefined && now - lastAt < SAME_CODE_DELAY_MS) return;
    if (!continuous && scanned) return;
    const payload = parseInventoryQrPayload(result.data);
    if (!payload) {
      if (!continuous) setScanned(true);
      setError('QR-код не содержит поддерживаемый инвентарный номер.');
      if (continuous) {
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(''), STREAM_ERROR_HIDE_MS);
      }
      return;
    }
    if (!continuous) setScanned(true);
    setError('');
    onScanned(payload);
  }, [continuous, onScanned, scanned]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View testID="native-qr-scanner-modal" style={[styles.root, { backgroundColor: '#05090d' }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть сканер QR-кода"
            onPress={onClose}
            style={styles.headerAction}
          >
            <MaterialCommunityIcons name="close" size={25} color="#fff" />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>Сканировать инвентарный QR</Text>
          <View style={styles.headerAction} />
        </View>

        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.help}>Проверяем доступ к камере…</Text>
          </View>
        ) : permission.granted ? (
          <View style={styles.cameraWrap}>
            <CameraView
              testID="native-database-qr-camera"
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={!continuous && scanned ? undefined : handleBarcode}
              onMountError={() => setError('Не удалось запустить камеру. Закройте сканер и попробуйте снова.')}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.finder} />
              <Text style={styles.help}>Наведите камеру на QR-код инвентарной карточки</Text>
            </View>
            {error ? (
              <View style={[styles.errorCard, continuous ? styles.errorCardTop : null, { backgroundColor: tokens.panelSolid }]}>
                <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text>
                {continuous ? null : (
                  <Pressable
                    testID="native-database-qr-rescan"
                    accessibilityRole="button"
                    accessibilityLabel="Сканировать другой QR-код"
                    onPress={() => { setScanned(false); setError(''); }}
                    style={[styles.button, { backgroundColor: tokens.primary }]}
                  >
                    <Text style={styles.buttonText}>Сканировать снова</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            {overlay ? <View pointerEvents="box-none" style={styles.overlayDock}>{overlay}</View> : null}
          </View>
        ) : (
          <View style={styles.center}>
            <MaterialCommunityIcons name="camera-off-outline" size={52} color="#fff" />
            <Text accessibilityRole="alert" style={styles.permissionTitle}>Камере нужен доступ</Text>
            <Text style={styles.help}>Без разрешения приложение не сможет считать инвентарный QR-код.</Text>
            <Pressable
              testID="native-database-qr-permission"
              accessibilityRole="button"
              onPress={() => {
                if (permission.canAskAgain) void requestPermission();
                else void Linking.openSettings();
              }}
              style={[styles.button, { backgroundColor: tokens.primary }]}
            >
              <Text style={styles.buttonText}>{permission.canAskAgain ? 'Разрешить камеру' : 'Открыть настройки'}</Text>
            </Pressable>
          </View>
        )}
        {/* Ш5-7: тосты рендерятся внутри нативной Modal — иначе на Android их
            перекрывает окно сканера («Уже в списке», «Нет связи…» и т.д.). */}
        <NativeToastHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, paddingTop: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 15 },
  cameraWrap: { flex: 1, overflow: 'hidden' },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  finder: { width: '78%', maxWidth: 320, aspectRatio: 1, borderWidth: 3, borderRadius: 24, borderColor: '#fff', backgroundColor: 'transparent' },
  help: { marginTop: 16, color: '#fff', textAlign: 'center', fontSize: 14, lineHeight: 21, fontWeight: '700' },
  permissionTitle: { color: '#fff', textAlign: 'center', fontSize: 21, fontWeight: '900' },
  errorCard: { position: 'absolute', left: 20, right: 20, bottom: 28, borderRadius: 18, padding: 16 },
  errorCardTop: { top: 16, bottom: undefined },
  overlayDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  error: { textAlign: 'center', fontSize: 13, lineHeight: 19, fontWeight: '800' },
  button: { minHeight: 48, minWidth: 190, marginTop: 14, borderRadius: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
