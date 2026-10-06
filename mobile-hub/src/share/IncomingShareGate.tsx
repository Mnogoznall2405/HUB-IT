import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import type { ChatConversationSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { NATIVE_CHAT_ENABLED } from '../chat/nativeChatFeature';
import { HubButton } from '../components/ui/HubButton';
import { openPortalPath } from '../navigation/moduleRegistry';
import { officeTokens } from '../theme/officeTokens';
import {
  copyIncomingShareFiles,
  discardIncomingShare,
  getPendingIncomingTextShare,
  queueIncomingShare,
  subscribeIncomingTextShare,
  type IncomingShare,
  type IncomingShareTarget,
} from './incomingShare';
import { ShareChatPicker } from './ShareChatPicker';

function formatShareSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}

function pluralFiles(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} файлов`;
  if (last === 1) return `${count} файл`;
  if (last >= 2 && last <= 4) return `${count} файла`;
  return `${count} файлов`;
}

/** One line for the dialog: "3 файла · 4,2 МБ". */
export function describeShareFiles(share: IncomingShare): string {
  const files = share.files || [];
  if (!files.length) return '';
  const total = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  const size = formatShareSize(total);
  return size ? `${pluralFiles(files.length)} · ${size}` : pluralFiles(files.length);
}

type Step = 'choose' | 'chat';

export function IncomingShareGate() {
  const { user, hasPermission } = useAuth();
  const reduceMotion = useReducedMotion();
  const [share, setShare] = useState<IncomingShare | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const receive = useCallback(async () => {
    const next = await getPendingIncomingTextShare();
    if (next) {
      setStep('choose');
      setError('');
      setShare(next);
    }
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

  const files = share?.files || [];
  const hasFiles = files.length > 0;
  const canChat = NATIVE_CHAT_ENABLED && hasPermission('chat.read');
  const canMail = hasPermission('mail.access');
  const canTask = hasPermission('tasks.read');

  const cancel = useCallback(() => {
    if (share) discardIncomingShare(share);
    setShare(null);
    setStep('choose');
    setError('');
  }, [share]);

  // Copies the files (only now that a destination is known), hands the share to the destination
  // screen and opens it. A failure keeps the dialog so the user can pick another place.
  const deliver = useCallback(async (
    target: IncomingShareTarget,
    destination: () => void,
    conversationId?: string,
  ) => {
    if (!share || busy) return;
    setBusy(true);
    setError('');
    try {
      const copiedFiles = hasFiles ? await copyIncomingShareFiles(share) : [];
      if (hasFiles && !copiedFiles.length) {
        setError('Не удалось подготовить файлы: тип не поддерживается, файл пустой или недоступен.');
        return;
      }
      queueIncomingShare(share, target, { copiedFiles, conversationId });
      setShare(null);
      setStep('choose');
      destination();
    } catch {
      setError('Не удалось подготовить файлы. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }, [busy, hasFiles, share]);

  const openChat = (conversation: ChatConversationSummary) => {
    void deliver('chat', () => router.push({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: conversation.id },
    }), conversation.id);
  };

  return (
    <Modal
      visible={Boolean(user && share)}
      animationType={reduceMotion ? 'none' : 'fade'}
      transparent
      onRequestClose={() => { if (step === 'chat' && !busy) setStep('choose'); else if (!busy) cancel(); }}
    >
      <SafeAreaView style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <View style={styles.iconShell}>
            <MaterialCommunityIcons
              name={hasFiles ? 'file-send-outline' : 'share-variant'}
              size={30}
              color={officeTokens.brand}
            />
          </View>
          <Text style={styles.title}>
            {step === 'chat' ? 'В какой чат отправить?' : 'Поделиться в HUB-IT'}
          </Text>

          {step === 'choose' ? (
            <>
              <Text style={styles.description}>
                {hasFiles
                  ? 'Выберите, куда отправить. Ничего не уйдёт, пока вы не подтвердите отправку.'
                  : 'Текст будет добавлен в черновик. Отправка произойдёт только после вашего подтверждения.'}
              </Text>
              {hasFiles ? (
                <View style={styles.filesBox} testID="incoming-share-files">
                  <Text style={styles.filesSummary}>{describeShareFiles(share as IncomingShare)}</Text>
                  {files.slice(0, 3).map((file, index) => (
                    <Text key={`${file.name}:${index}`} style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                  ))}
                  {files.length > 3 ? <Text style={styles.fileName}>и ещё {files.length - 3}</Text> : null}
                </View>
              ) : null}
              {share?.subject ? <Text style={styles.subject} numberOfLines={2}>{share.subject}</Text> : null}
              {share?.text.trim() ? <Text style={styles.preview} numberOfLines={hasFiles ? 2 : 5}>{share.text}</Text> : null}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                {canChat ? (
                  <HubButton
                    mode="contained"
                    icon="message-text-outline"
                    disabled={busy}
                    onPress={() => setStep('chat')}
                  >
                    Отправить в чат
                  </HubButton>
                ) : null}
                {canMail ? (
                  <HubButton
                    mode={canChat ? 'outlined' : 'contained'}
                    icon="email-edit-outline"
                    disabled={busy}
                    onPress={() => { void deliver('mail', () => openPortalPath('/mail?compose=new')); }}
                  >
                    Создать письмо
                  </HubButton>
                ) : null}
                {canTask ? (
                  <HubButton
                    mode="outlined"
                    icon="clipboard-text-outline"
                    disabled={busy}
                    onPress={() => { void deliver('task', () => openPortalPath('/tasks?create=1')); }}
                  >
                    Создать задачу
                  </HubButton>
                ) : null}
              </View>
              {busy ? <ActivityIndicator color={officeTokens.brand} /> : null}
              <HubButton mode="text" disabled={busy} onPress={cancel}>
                Отменить
              </HubButton>
            </>
          ) : (
            <>
              {busy ? <ActivityIndicator color={officeTokens.brand} /> : null}
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <ShareChatPicker userId={Number(user?.id || 0)} onPick={openChat} />
              <HubButton mode="text" disabled={busy} onPress={() => setStep('choose')}>
                Назад
              </HubButton>
            </>
          )}
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
  filesBox: {
    gap: 3,
    padding: 12,
    borderRadius: 12,
    backgroundColor: officeTokens.pageBg,
  },
  filesSummary: { color: officeTokens.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  fileName: { color: officeTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  subject: { color: officeTokens.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  preview: {
    minHeight: 40,
    padding: 12,
    borderRadius: 12,
    color: officeTokens.textPrimary,
    backgroundColor: officeTokens.pageBg,
    fontSize: 14,
    lineHeight: 20,
  },
  error: { color: '#c0392b', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  actions: { gap: 8 },
});
