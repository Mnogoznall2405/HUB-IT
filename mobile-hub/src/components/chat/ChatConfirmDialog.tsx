import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { useChatTokens, type ChatTokens } from '../../theme/chatTokens';

// In-app confirmation for destructive chat actions (delete message/chat, clear
// context, remove from queue, leave group, delete folder/set). Plain notices
// and choices keep using toasts and Alert. When no ChatConfirmHost is mounted
// the request falls back to Alert.alert, so a confirmation is never skipped.

export type ChatConfirmOptions = {
  title: string;
  message?: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
};

type PendingConfirm = ChatConfirmOptions & { resolve: (confirmed: boolean) => void };
type ConfirmHost = (request: PendingConfirm) => void;

const mountedHosts: ConfirmHost[] = [];

export function confirmChatAction(options: ChatConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const host = mountedHosts[mountedHosts.length - 1];
    if (!host) {
      Alert.alert(
        options.title,
        options.message,
        [
          { text: options.cancelText || 'Отмена', style: 'cancel', onPress: () => resolve(false) },
          {
            text: options.confirmText,
            style: options.destructive ? 'destructive' : 'default',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
      return;
    }
    host({ ...options, resolve });
  });
}

export function ChatConfirmHost() {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const reduceMotion = useReducedMotion();
  const [request, setRequest] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const finish = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    current?.resolve(confirmed);
  }, []);

  useEffect(() => {
    const host: ConfirmHost = (next) => {
      // A newer request supersedes an unanswered one: its caller gets "no".
      pendingRef.current?.resolve(false);
      pendingRef.current = next;
      setRequest(next);
    };
    mountedHosts.push(host);
    return () => {
      const index = mountedHosts.indexOf(host);
      if (index >= 0) mountedHosts.splice(index, 1);
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  return (
    <Modal
      visible={Boolean(request)}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => finish(false)}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => finish(false)}
          accessibilityRole="button"
          accessibilityLabel="Закрыть подтверждение"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{request?.title}</Text>
          {request?.message ? <Text style={styles.message}>{request.message}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={() => finish(false)}
              accessibilityRole="button"
              testID="chat-confirm-cancel"
              accessibilityLabel={request?.cancelText || 'Отмена'}
              style={styles.button}
            >
              <Text style={styles.cancelText}>{request?.cancelText || 'Отмена'}</Text>
            </Pressable>
            <Pressable
              onPress={() => finish(true)}
              accessibilityRole="button"
              testID="chat-confirm-accept"
              accessibilityLabel={request?.confirmText}
              style={styles.button}
            >
              <Text style={[styles.confirmText, request?.destructive && styles.destructiveText]}>
                {request?.confirmText}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: chatTokens.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 14,
    padding: 20,
    backgroundColor: chatTokens.panelBg,
  },
  title: { fontSize: 17, fontWeight: '700', color: chatTokens.textPrimary },
  message: { marginTop: 8, fontSize: 14, lineHeight: 20, color: chatTokens.textSecondary },
  actions: { marginTop: 20, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: chatTokens.accentText },
  confirmText: { fontSize: 15, fontWeight: '600', color: chatTokens.accentText },
  destructiveText: { color: chatTokens.dangerText },
});
