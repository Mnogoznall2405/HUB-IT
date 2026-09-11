import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { useAuth } from '../../auth/AuthContext';
import { createNativeChatOutbox, readNativeChatOutbox, subscribeNativeChatOutbox, type NativeChatOutboxEntry } from '../../chat/nativeChatOutbox';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { useChatTokens } from '../../theme/chatTokens';
import { inspectNativeChatDraftFiles } from '../../chat/nativeChatDraftFiles';

type Row = NativeChatOutboxEntry & { busy: boolean };
function deliveryLabel(row: Row) {
  if (row.delivery?.confirmed) return 'Отправлено. Сохраняется в истории';
  if (row.busy) return 'Отправляется…';
  if (row.delivery?.state === 'queued') return 'Ожидает доставки';
  if (row.delivery?.state === 'retry') return 'Связь прервалась. Ожидает повтора';
  if (row.delivery?.state === 'cancelled') return 'Отправка отменена';
  return 'Ожидает ручного повтора';
}
export function NativeChatOutboxScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const allowed = hasPermission('chat.read');
  const canSend = hasPermission('chat.write');
  const userId = Number(user?.id || 0);
  const access = useRef({ userId, allowed, canSend });
  access.current = { userId, allowed, canSend };
  const tokens = useChatTokens();
  const bottom = useNativeBottomNavInset();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [inspection, setInspection] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const inspectionRun = useRef(0);
  const busy = useRef(false);
  const active = useRef(false);
  const epoch = useRef(0);
  const scope = useRef(0);
  const load = useCallback(async () => {
    if (!allowed || !userId) { setLoading(false); setRows([]); return; }
    const request = ++epoch.current;
    try {
      const entries = await readNativeChatOutbox(userId);
      if (active.current && request === epoch.current) { setRows(entries); setError(''); }
    } catch {
      if (active.current && request === epoch.current) setError('Не удалось прочитать очередь. Сохранённые сообщения не удалены.');
    } finally {
      if (active.current && request === epoch.current) setLoading(false);
    }
  }, [allowed, userId]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    scope.current += 1;
    busy.current = false; setBusyId(''); setActionError('');
    inspectionRun.current += 1; setInspection(''); setInspecting(false);
    setRows([]); setLoading(true);
    void load();
    const unsubscribe = subscribeNativeChatOutbox(() => { void load(); });
    return () => { active.current = false; scope.current += 1; epoch.current += 1; unsubscribe(); };
  }, [load]));

  const inspectFiles = async () => {
    if (!active.current || !allowed || !userId || inspecting || access.current.userId !== userId || !access.current.allowed) return;
    const runId = ++inspectionRun.current;
    const inspectionScope = scope.current;
    setInspecting(true);
    const current = () => active.current && scope.current === inspectionScope && runId === inspectionRun.current
      && access.current.userId === userId && access.current.allowed;
    try {
      const result = await inspectNativeChatDraftFiles(userId);
      if (!current()) return;
      setInspection(`Проверено файлов: ${result.files}. Без сохранённой связи с сообщениями: ${result.unlinked} (${Math.ceil(result.unlinkedBytes / 1024)} КБ). Недоступных вложений: ${result.missing}. ${result.complete ? '' : 'Проверка неполная. '}Файлы не удалены.`);
    } catch {
      if (current()) setInspection('Не удалось проверить файлы. Сохранённые сообщения и вложения не изменены.');
    } finally { if (current()) setInspecting(false); }
  };

  const run = useCallback(async (row: Row, discard = false) => {
    if (busy.current || row.busy || !active.current || row.userId !== userId
      || access.current.userId !== userId || !access.current.allowed
      || (!discard && !access.current.canSend) || row.delivery?.confirmed) return;
    busy.current = true;
    const operationScope = scope.current;
    const id = row.message.client_message_id!;
    setBusyId(`${row.message.conversation_id}:${id}`); setActionError('');
    const session = createNativeChatOutbox(userId, row.message.conversation_id);
    try {
      if (discard) await session.discard(id);
      else await session.retryDelivery(id);
    } catch {
      if (active.current && scope.current === operationScope) setActionError('Не удалось изменить очередь. Сообщение сохранено; повторите действие.');
    } finally {
      if (scope.current === operationScope) {
        busy.current = false;
        if (active.current) setBusyId('');
      }
    }
  }, [userId]);
  const cancel = (row: Row) => {
    if (!active.current || row.userId !== access.current.userId || !access.current.allowed) return;
    void createNativeChatOutbox(row.userId, row.message.conversation_id).cancelDelivery(row.message.client_message_id!).catch(() => {
      if (active.current) setActionError('Не удалось отменить доставку. Повторите действие.');
    });
  };
  const withoutQuote = (row: Row) => {
    const operationScope = scope.current;
    const current = () => active.current && scope.current === operationScope && access.current.userId === row.userId
      && access.current.allowed && access.current.canSend;
    Alert.alert('Отправить без цитаты?', 'Проверьте переписку: прежняя отправка могла пройти без подтверждения. Будет создано новое сообщение.', [
      { text: 'Оставить', style: 'cancel' },
      { text: 'Отправить', onPress: () => {
        if (!current() || busy.current) return;
        busy.current = true;
        const session = createNativeChatOutbox(row.userId, row.message.conversation_id);
        const replacementId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        void session.detachReply(row.message.client_message_id!, replacementId, current).then(async () => {
          if (current()) await session.retryDelivery(replacementId);
        }).catch(() => {
          if (current()) setActionError('Не удалось изменить ответ. Проверьте очередь перед повтором.');
        }).finally(() => { if (scope.current === operationScope) busy.current = false; });
      } },
    ]);
  };

  const discard = (row: Row) => {
    const confirmationScope = scope.current;
    Alert.alert('Убрать сообщение из очереди?', 'Если сервер уже получил сообщение, оно останется в переписке.', [
    { text: 'Оставить', style: 'cancel' },
    { text: 'Убрать', style: 'destructive', onPress: () => {
      if (scope.current === confirmationScope) void run(row, true);
    } },
    ]);
  };
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: tokens.threadBg }]}>
    <View style={[styles.header, { backgroundColor: tokens.threadTopbarBg }]}>
      <IconButton icon="arrow-left" accessibilityLabel="Назад к чатам" onPress={() => router.canGoBack() ? router.back() : router.replace('/(shell)/chat')} />
      <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>Очередь отправки</Text>
      <IconButton icon="refresh" accessibilityLabel="Обновить очередь" onPress={() => { void load(); }} />
    </View>
    {!allowed ? <Text style={[styles.notice, { color: tokens.textPrimary }]}>Нет доступа к чату</Text> : <>
      <Pressable accessibilityRole="button" accessibilityLabel="Проверить сохранённые файлы" accessibilityState={{ disabled: inspecting, busy: inspecting }}
        disabled={inspecting} onPress={() => { void inspectFiles(); }} style={styles.action}>
        <Text style={{ color: tokens.composerActionBg }}>{inspecting ? 'Проверка файлов…' : 'Проверить сохранённые файлы'}</Text>
      </Pressable>
      {inspection ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textPrimary }]}>{inspection}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.textPrimary }]}>{error}</Text> : null}
      {actionError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.textPrimary }]}>{actionError}</Text> : null}
      {offlineMode ? <Text style={[styles.notice, { color: tokens.textPrimary }]}>Новые сообщения отправятся после подключения, пока приложение открыто и разблокировано. Старые ошибки требуют ручного повтора.</Text> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Загрузка очереди" /> : <FlatList
        data={rows.filter((row) => row.userId === userId)} keyExtractor={(row) => `${row.message.conversation_id}:${row.message.client_message_id}`}
        contentContainerStyle={{ padding: 12, paddingBottom: bottom + 16 }}
        ListEmptyComponent={!error ? <Text style={[styles.notice, { color: tokens.textPrimary }]}>Нет сообщений, ожидающих отправки</Text> : null}
        renderItem={({ item }) => <View style={[styles.card, { backgroundColor: tokens.panelBg }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Открыть диалог: ${item.title || 'Диалог'}`} style={styles.open} onPress={() => router.push({ pathname: '/(shell)/chat/[conversationId]', params: { conversationId: item.message.conversation_id } })}>
            <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{item.title || 'Диалог'}</Text>
            <Text numberOfLines={3} style={{ color: tokens.textPrimary }}>{item.message.body_text || 'Вложение без подписи'}</Text>
            <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>{deliveryLabel(item)}{item.upload ? ` · Файлов: ${item.upload.files.length}` : ''}</Text>
          </Pressable>
          <View style={styles.actions}>
            {item.delivery && ['queued', 'retry', 'sending'].includes(item.delivery.state) ? <Pressable
              accessibilityRole="button" accessibilityLabel="Отменить доставку" disabled={Boolean(busyId)} style={styles.action}
              onPress={() => cancel(item)}><Text style={{ color: tokens.textSecondary }}>Отменить</Text></Pressable> : null}
            {item.delivery?.replyMissing ? <Pressable accessibilityRole="button" accessibilityLabel="Отправить без цитаты"
              disabled={!canSend || item.busy || Boolean(busyId)} style={styles.action}
              onPress={() => withoutQuote(item)}><Text style={{ color: tokens.composerActionBg }}>Без цитаты</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Повторить отправку" disabled={!canSend || item.busy || Boolean(busyId) || Boolean(item.delivery?.confirmed) || ['queued', 'retry'].includes(item.delivery?.state || '')} style={styles.action} onPress={() => { void run(item); }}><Text style={{ color: !canSend || item.busy || busyId ? tokens.textSecondary : tokens.composerActionBg }}>Повторить</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Убрать сообщение из очереди" disabled={item.busy || Boolean(busyId) || Boolean(item.delivery?.confirmed)} style={styles.action} onPress={() => discard(item)}><Text style={{ color: tokens.textSecondary }}>Убрать</Text></Pressable>
          </View>
        </View>}
      />}
    </>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 20, fontWeight: '700' }, notice: { padding: 16, fontSize: 14, lineHeight: 20 },
  card: { borderRadius: 14, marginBottom: 10, padding: 12 }, open: { minHeight: 48, gap: 6 },
  rowTitle: { fontSize: 16, fontWeight: '700' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
});
