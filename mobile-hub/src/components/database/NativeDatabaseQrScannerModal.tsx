import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { parseInventoryQrPayload, type InventoryQrPayload } from '../../database/nativeDatabaseModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export function NativeDatabaseQrScannerModal({
  visible,
  tokens,
  onClose,
  onScanned,
}: {
  visible: boolean;
  tokens: FluentTokens;
  onClose: () => void;
  onScanned: (payload: InventoryQrPayload) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) {
      setScanned(false);
      setError('');
    }
  }, [visible]);

  const handleBarcode = useCallback((result: BarcodeScanningResult) => {
    if (scanned) return;
    const payload = parseInventoryQrPayload(result.data);
    if (!payload) {
      setScanned(true);
      setError('QR-код не содержит поддерживаемый инвентарный номер.');
      return;
    }
    setScanned(true);
    setError('');
    onScanned(payload);
  }, [onScanned, scanned]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={[styles.root, { backgroundColor: '#05090d' }]}>
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
              onBarcodeScanned={scanned ? undefined : handleBarcode}
              onMountError={() => setError('Не удалось запустить камеру. Закройте сканер и попробуйте снова.')}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.finder} />
              <Text style={styles.help}>Наведите камеру на QR-код инвентарной карточки</Text>
            </View>
            {error ? (
              <View style={[styles.errorCard, { backgroundColor: tokens.panelSolid }]}> 
                <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text>
                <Pressable
                  testID="native-database-qr-rescan"
                  accessibilityRole="button"
                  accessibilityLabel="Сканировать другой QR-код"
                  onPress={() => { setScanned(false); setError(''); }}
                  style={[styles.button, { backgroundColor: tokens.primary }]}
                >
                  <Text style={styles.buttonText}>Сканировать снова</Text>
                </Pressable>
              </View>
            ) : null}
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
  error: { textAlign: 'center', fontSize: 13, lineHeight: 19, fontWeight: '800' },
  button: { minHeight: 48, minWidth: 190, marginTop: 14, borderRadius: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
