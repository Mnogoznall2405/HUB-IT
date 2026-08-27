import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { useAuth } from '../auth/AuthContext';
import { HubButton } from '../components/ui/HubButton';
import { openPortalPath } from '../navigation/moduleRegistry';
import { officeTokens } from '../theme/officeTokens';
import {
  getPendingIncomingTextShare,
  queueIncomingShare,
  subscribeIncomingTextShare,
  type IncomingTextShare,
} from './incomingShare';

export function IncomingShareGate() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const [share, setShare] = useState<IncomingTextShare | null>(null);

  const receive = useCallback(async () => {
    const next = await getPendingIncomingTextShare();
    if (next) setShare(next);
  }, []);

  useEffect(() => {
    void receive();
    const unsubscribe = subscribeIncomingTextShare(() => { void receive(); });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void receive();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [receive]);

  const openTarget = (target: 'mail' | 'task') => {
    if (!share) return;
    queueIncomingShare(share, target);
    setShare(null);
    openPortalPath(
      target === 'mail'
        ? '/mail?compose=new'
        : '/tasks?create=1',
    );
  };

  return (
    <Modal
      visible={Boolean(user && share)}
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      onRequestClose={() => setShare(null)}
    >
      <SafeAreaView style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <View style={styles.iconShell}>
            <MaterialCommunityIcons name="share-variant" size={30} color={officeTokens.brand} />
          </View>
          <Text style={styles.title}>Поделиться в HUB-IT</Text>
          <Text style={styles.description}>
            Текст будет добавлен в черновик. Отправка произойдёт только после вашего подтверждения.
          </Text>
          {share?.subject ? <Text style={styles.subject} numberOfLines={2}>{share.subject}</Text> : null}
          <Text style={styles.preview} numberOfLines={5}>{share?.text}</Text>
          <View style={styles.actions}>
            <HubButton mode="contained" icon="email-edit-outline" onPress={() => openTarget('mail')}>
              Создать письмо
            </HubButton>
            <HubButton mode="outlined" icon="clipboard-text-outline" onPress={() => openTarget('task')}>
              Создать задачу
            </HubButton>
          </View>
          <HubButton mode="text" onPress={() => setShare(null)}>
            Отменить
          </HubButton>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(4, 18, 30, 0.56)',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 20,
    backgroundColor: officeTokens.panelBg,
  },
  iconShell: {
    width: 52,
    height: 52,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: officeTokens.selectedBg,
  },
  title: { color: officeTokens.textPrimary, fontSize: 21, lineHeight: 27, fontWeight: '900', textAlign: 'center' },
  description: { color: officeTokens.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  subject: { color: officeTokens.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  preview: {
    minHeight: 72,
    padding: 12,
    borderRadius: 12,
    color: officeTokens.textPrimary,
    backgroundColor: officeTokens.pageBg,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: { gap: 8 },
});
