import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as chatApi from '../../api/chatApi';
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
  const { chatTokens, styles } = useChatStyles(createStyles);
  const [state, setState] = useState<ChatAiSandboxState>(() => normalizeAiSandboxPayload({ enabled: false }));
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const id = String(conversationId || '').trim();
    if (!visible || !id) {
      setState(normalizeAiSandboxPayload({ enabled: false }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await chatApi.getAiSandboxConversation(id);
      setState(normalizeAiSandboxPayload(payload));
    } catch (cause) {
      const status = Number((cause as { response?: { status?: number } })?.response?.status || 0);
      if (status === 404) {
        setState(normalizeAiSandboxPayload({ enabled: false }));
        setError('');
      } else {
        setError('Не удалось загрузить состояние OpenCode workspace.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [conversationId, visible]);

  const respond = async (permissionId: string, decision: 'allow' | 'reject', scope: 'once' | 'session') => {
    setBusyKey(`permission:${permissionId}`);
    setError('');
    setNotice('');
    try {
      await chatApi.respondAiSandboxPermission(permissionId, decision, scope);
      setNotice(decision === 'allow' ? 'Разрешение передано OpenCode.' : 'Действие отклонено.');
      await load();
    } catch {
      setError('Не удалось ответить на запрос разрешения.');
    } finally {
      setBusyKey('');
    }
  };

  const attachFile = async (fileId: string) => {
    setBusyKey(`attach:${fileId}`);
    setError('');
    try {
      await chatApi.attachAiSandboxFile(fileId);
      setNotice('Файл прикреплён к чату.');
      await load();
    } catch {
      setError('Не удалось прикрепить файл к чату.');
    } finally {
      setBusyKey('');
    }
  };

  const attachArchive = async () => {
    const id = String(conversationId || '').trim();
    if (!id) return;
    setBusyKey('attach:archive');
    setError('');
    try {
      await chatApi.attachAiSandboxArchive(id);
      setNotice('Архив workspace прикреплён к чату.');
      await load();
    } catch {
      setError('Не удалось прикрепить архив workspace.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>OpenCode workspace</Text>
        {state.jobStatus ? <Text style={styles.status}>{state.jobLabel}</Text> : null}
      </View>
      {loading ? (
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator color={chatTokens.composerActionBg} />
          <Text style={styles.meta}>Загружаю workspace…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {!loading && !state.enabled ? (
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
              disabled={busyKey === `permission:${permission.id}`}
              onPress={() => void respond(permission.id, 'reject', 'once')}
            />
            <Action
              label="Разрешить один раз"
              disabled={busyKey === `permission:${permission.id}`}
              onPress={() => void respond(permission.id, 'allow', 'once')}
            />
            <Action
              label="До конца сессии"
              disabled={busyKey === `permission:${permission.id}`}
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
              {canAttachSandboxFile(file) && file.id ? (
                <Action
                  label="Прикрепить"
                  disabled={busyKey === `attach:${file.id}`}
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
            disabled={busyKey === 'attach:archive'}
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
