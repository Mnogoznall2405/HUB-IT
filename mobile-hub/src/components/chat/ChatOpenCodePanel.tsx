import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as chatApi from '../../api/chatApi';
import { useAuth } from '../../auth/AuthContext';
import { useAiAgentAccess } from '../../chat/useAiAgentAccess';
import {
  canAttachSandboxFile,
  normalizeAiSandboxPayload,
  type ChatAiSandboxState,
} from '../../chat/chatAiSandbox';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function ChatOpenCodePanel({
  conversationId,
  visible,
}: {
  conversationId?: string | null;
  visible: boolean;
}) {
  const { user, offlineMode } = useAuth();
  if (!visible || !conversationId) return null;
  return <OpenCodePanel key={`${user?.id}:${conversationId}:${offlineMode}`} conversationId={conversationId} offline={offlineMode} userId={user?.id} />;
}

function OpenCodePanel({ conversationId, offline, userId }: { conversationId: string; offline: boolean; userId?: number }) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const access = useAiAgentAccess(conversationId, true, userId, offline);
  const live = useRef(true);
  const pending = useRef(false);
  const mutation = useRef(false);
  const sequence = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; sequence.current += 1; }; }, []);
  const [state, setState] = useState<ChatAiSandboxState>(() => normalizeAiSandboxPayload({ enabled: false }));
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!live.current || offline || pending.current || (AppState.currentState && AppState.currentState !== 'active')) return;
    const request = ++sequence.current;
    const current = () => live.current && request === sequence.current;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const payload = await chatApi.getAiSandboxConversation(conversationId);
      if (!current()) return;
      setState(normalizeAiSandboxPayload(payload));
    } catch (cause) {
      if (!current()) return;
      const status = Number((cause as { response?: { status?: number } })?.response?.status || 0);
      if (status === 404) {
        setState(normalizeAiSandboxPayload({ enabled: false }));
        setError('');
      } else {
        setError('Не удалось загрузить состояние OpenCode workspace.');
      }
    } finally {
      if (current()) pending.current = false;
      if (current()) setLoading(false);
    }
  }, [conversationId, offline]);

  useFocusEffect(useCallback(() => {
    live.current = true;
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const subscription = AppState.addEventListener('change', (next) => {
      sequence.current += 1;
      pending.current = false;
      if (next === 'active') void load();
    });
    return () => { live.current = false; sequence.current += 1; pending.current = false; clearInterval(timer); subscription.remove(); };
  }, [load]));

  const runAction = async (key: string, action: () => Promise<void>, success: string, failure: string) => {
    if (mutation.current || !live.current || !access.allowed || offline) return;
    mutation.current = true;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await action();
      if (!live.current) return;
      setNotice(success);
      await load();
    } catch {
      if (live.current) setError(failure);
    } finally {
      mutation.current = false;
      if (live.current) setBusyKey('');
    }
  };

  const respond = async (permissionId: string, decision: 'allow' | 'reject', scope: 'once' | 'session') => {
    await runAction(`permission:${permissionId}`, () => chatApi.respondAiSandboxPermission(permissionId, decision, scope),
      decision === 'allow' ? 'Разрешение передано OpenCode.' : 'Действие отклонено.', 'Не удалось ответить на запрос разрешения.');
  };

  const attachFile = async (fileId: string) => {
    await runAction(`attach:${fileId}`, () => chatApi.attachAiSandboxFile(fileId),
      'Доставка файла запрошена. Он появится в чате после обработки.', 'Не удалось запросить доставку файла.');
  };

  const attachArchive = async () => {
    await runAction('attach:archive', () => chatApi.attachAiSandboxArchive(conversationId),
      'Подготовка архива запрошена. Он появится в чате после обработки.', 'Не удалось запросить подготовку архива.');
  };
  const actionsDisabled = Boolean(busyKey) || !access.allowed || offline;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>OpenCode workspace</Text>
        {state.jobStatus ? <Text style={styles.status}>{state.jobLabel}</Text> : null}
      </View>
      {offline ? <Text style={styles.meta}>Нет сети. Подключитесь, чтобы обновить состояние OpenCode.</Text> : (
        <Action label="Обновить состояние OpenCode" disabled={loading || Boolean(busyKey)} onPress={() => { void load(); }} />
      )}
      {!offline && !access.allowed ? <Text style={styles.meta}>{access.loading ? 'Проверяем доступ к агенту…' : access.error ? 'Не удалось проверить доступ. Действия временно недоступны.' : 'Доступ к агенту не предоставлен или отозван. История доступна для просмотра.'}</Text> : null}
      {loading ? (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator color={chatTokens.composerActionBg} />
          <Text style={styles.meta}>Загружаю workspace…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {!offline && !loading && !error && !state.enabled ? (
        <Text style={styles.meta}>OpenCode сейчас отключён для этого диалога.</Text>
      ) : null}
      {state.enabled && state.pendingPermissions.map((permission) => (
        <View key={permission.id} style={styles.card}>
          <Text style={styles.cardTitle}>{permission.title}</Text>
          {permission.detail ? <Text style={styles.meta}>{permission.detail}</Text> : null}
          {permission.argumentsText ? <Text style={styles.code}>{permission.argumentsText}</Text> : null}
          <View style={styles.actions}>
            <Action
              label="Отклонить"
              disabled={actionsDisabled}
              onPress={() => void respond(permission.id, 'reject', 'once')}
            />
            <Action
              label="Разрешить один раз"
              disabled={actionsDisabled}
              onPress={() => void respond(permission.id, 'allow', 'once')}
            />
            <Action
              label="До конца сессии"
              disabled={actionsDisabled}
              onPress={() => void respond(permission.id, 'allow', 'session')}
            />
          </View>
        </View>
      ))}
      {state.enabled ? (
        <>
          <Text style={styles.subtitle}>Файлы workspace</Text>
          {state.files.length ? state.files.map((file) => (
            <View key={file.id || file.path} style={styles.card}>
              <Text style={styles.cardTitle}>{file.path}</Text>
              {file.changed ? <Text style={styles.meta}>Изменён</Text> : null}
              {file.availability === 'pending' ? <Text style={styles.meta}>Доставка в чат выполняется…</Text> : null}
              {file.availability === 'attached' ? <Text style={styles.notice}>Доставлен в чат</Text> : null}
              {file.availability === 'unavailable' ? <Text style={styles.error}>Файл недоступен для доставки</Text> : null}
              {canAttachSandboxFile(file) && file.id ? (
                <Action
                  label="Прикрепить"
                  disabled={actionsDisabled}
                  onPress={() => void attachFile(file.id)}
                />
              ) : null}
            </View>
          )) : (
            <Text style={styles.meta}>Файлов пока нет.</Text>
          )}
          <Text style={styles.subtitle}>Изменения</Text>
          {state.diffs.length ? state.diffs.map((entry, index) => (
            <View key={`${entry.path}:${index}`} style={styles.card}>
              <Text style={styles.cardTitle}>{entry.path}</Text>
              {entry.patch ? <Text style={styles.code}>{entry.patch}</Text> : null}
            </View>
          )) : (
            <Text style={styles.meta}>Изменений пока нет.</Text>
          )}
          <Action
            label="Прикрепить архив"
            disabled={actionsDisabled}
            onPress={() => void attachArchive()}
          />
        </>
      ) : null}
    </View>
  );
}

function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  section: { marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: chatTokens.sidebarSearchBg, gap: 8 },
  header: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  status: { color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  subtitle: { marginTop: 6, color: chatTokens.textPrimary, fontSize: 13, fontWeight: '700' },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { color: chatTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  error: { color: chatTokens.dangerText, fontSize: 13 },
  notice: { color: chatTokens.accentText, fontSize: 13 },
  card: { padding: 10, borderRadius: 12, backgroundColor: chatTokens.panelBg, gap: 6 },
  cardTitle: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: '700' },
  code: { color: chatTokens.textSecondary, fontFamily: 'monospace', fontSize: 12 },
  actions: { gap: 6 },
  action: {
    minHeight: 44,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: chatTokens.panelBg,
  },
  actionText: { color: chatTokens.accentText, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
