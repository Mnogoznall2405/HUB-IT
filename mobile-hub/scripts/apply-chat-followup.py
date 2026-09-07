"""One-shot, hash-guarded source edit for draft PR #5. Dry-run unless --apply.
No network, dependencies, user data, server configuration, or automatic commits.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {
    'mobile-hub/src/screens/chat/NativeChatThreadScreen.tsx': '9d9ce63ff07636c6579fd1a3062b986a4ed036ae',
    'mobile-hub/src/auth/AppLockGate.tsx': '95e30732e1cf85df696bc4c2b6970c1cbaf09142',
    'mobile-hub/app/(shell)/chat/[conversationId].tsx': '76a0f03fbe6b226d9234b61922b13ad2606eec4f',
    'mobile-hub/src/screens/chat/NativeChatOutboxScreen.tsx': 'a80ad3be61ccb15e7efa8498e466786816cb5bef',
    'mobile-hub/src/chat/NativeChatDeliveryHost.tsx': 'e47486d2a650568ee0c67472f3505ccc6bc587ec',
    'mobile-hub/src/screens/chat/NativeChatInboxScreen.tsx': 'c6af3ab875b4b03e8155b2a995a02e58845ab353',
}

def git_sha(data: bytes) -> str:
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()

def replace_once(text: str, before: str, after: str, count: int = 1) -> str:
    actual = text.count(before)
    if actual != count:
        raise ValueError(f'Expected {count} exact anchors, got {actual}: {before[:100]!r}')
    return text.replace(before, after)

def between(text: str, start: str, end: str, replacement: str) -> str:
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + replacement + text[b:]

def thread(text: str) -> str:
    def rep(a: str, b: str, count: int = 1):
        nonlocal text
        text = replace_once(text, a, b, count)
    rep("import axios from 'axios';\n", '')
    rep('  buildAttachmentsFormData,\n', '')
    rep("import { createNativeChatOutbox } from '../../chat/nativeChatOutbox';", "import { createNativeChatOutbox, getNativeChatQueueState } from '../../chat/nativeChatOutbox';\nimport { useNativeChatOutboxMessages } from '../../chat/useNativeChatOutboxMessages';")
    rep("import { createNativeChatLeaveController } from '../../chat/nativeChatLeaveThread';\n", '')
    rep("  const canCompose = hasPermission('chat.write');", "  const historySessionGeneration = useMemo(() => getNativeChatThreadHistoryGeneration(), [user?.id]);\n  const loadedThreadScopeRef = useRef('');\n  const canCompose = hasPermission('chat.write');")
    rep('  const canWrite = canCompose;', '  const canWrite = canCompose && !offlineMode;')
    rep('[conversationId, user?.id, canCompose, offlineMode]', '[conversationId, user?.id, canCompose]')
    rep("  const leaveControllerRef = useRef(createNativeChatLeaveController({\n    navigateAway: () => undefined,\n  }));\n", '')
    rep('  const loadGenerationRef = useRef(0);', '''  useNativeChatOutboxMessages(outbox, Number(user?.id || 0), conversationId,
    setMessages, pendingAttachmentUploadsRef, setAttachmentTransfers);
  const loadGenerationRef = useRef(0);''')
    text = between(text, '  const leaveThread = useCallback(', '\n  useEffect(() => {\n    leaveInFlightRef.current', '''  const leaveThread = useCallback(() => {
    if (leaveInFlightRef.current) return;
    requestLeave(() => {
      if (leaveInFlightRef.current || !mountedRef.current) return;
      leaveInFlightRef.current = true;
      const latest = findLatestIncomingMessage(messagesRef.current, user?.id);
      notifyNativeChatConversationRead(conversationId);
      Keyboard.dismiss();
      if (router.canGoBack?.()) router.back();
      else router.replace('/(shell)/chat');
      if (!offlineMode && latest?.id) {
        void chatApi.markConversationRead(conversationId, latest.id).catch(() => undefined);
      }
    });
  }, [conversationId, offlineMode, requestLeave, user?.id]);
''')
    rep('    accumulatedMessagesRef.current = [];\n    historyMayHaveGapsRef.current = false;', '''    accumulatedMessagesRef.current = [];
    historyMayHaveGapsRef.current = false;
    loadedThreadScopeRef.current = '';
    setThreadHydrated(false);
    setMessages([]);
    setConversation(null);
    setTitle('Chat');''')
    rep('      mountedRef.current = false;\n      incomingTypingTimeoutsRef', '      mountedRef.current = false;\n      loadGenerationRef.current += 1;\n      incomingTypingTimeoutsRef')
    rep('        mountedRef.current = false;\n        incomingTypingTimeoutsRef', '        mountedRef.current = false;\n        loadGenerationRef.current += 1;\n        incomingTypingTimeoutsRef')
    rep('      uploadControllersRef.current.forEach((controller) => controller.abort());\n      uploadControllersRef.current.clear();', '      // Persisted uploads belong to the session delivery host.\n      uploadControllersRef.current.clear();')
    rep('          setHistoryUnavailableOffline(true);\n          setThreadHydrated(true);', '          setHistoryUnavailableOffline(true);', 2)
    rep('        setMessages(normalized);\n        setConversation(cached.data.conversation', '        setMessages((current) => mergeMessages(normalized, current, user?.id));\n        setConversation(cached.data.conversation')
    a = text.index('  const loadInitial =')
    b = text.index('  const loadOlder =', a)
    section = text[a:b]
    section = replace_once(section, '        setThreadHydrated(true);', '        loadedThreadScopeRef.current = JSON.stringify([scopeUserId, scopeConversationId]);\n        setThreadHydrated(true);')
    section = replace_once(section, '\n      setThreadHydrated(true);', '\n      loadedThreadScopeRef.current = JSON.stringify([scopeUserId, scopeConversationId]);\n      setThreadHydrated(true);')
    text = text[:a] + section + text[b:]
    text = between(text, '  useEffect(() => {\n    const userId = Number(user?.id || 0);\n    if (!threadHydrated', '\n  const loadOlder =', '''  const pendingHistoryWriteRef = useRef<{
    userId: number; conversationId: string; generation: number; snapshot: ChatThreadSnapshot;
  } | null>(null);
  const flushHistoryWrite = useCallback(() => {
    const pending = pendingHistoryWriteRef.current;
    if (!pending) return;
    pendingHistoryWriteRef.current = null;
    void scheduleNativeChatThreadSnapshotWrite(pending.userId, pending.conversationId,
      pending.snapshot, { generation: pending.generation, currentUserId: pending.userId });
  }, []);
  useEffect(() => {
    const userId = Number(user?.id || 0);
    if (!threadHydrated || historyUnavailableOffline || userId <= 0
      || loadedThreadScopeRef.current !== JSON.stringify([userId, conversationId])
      || historySessionGeneration !== getNativeChatThreadHistoryGeneration()) return;
    accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
      accumulatedMessagesRef.current, messages.filter((message) => !message.local_status), userId,
    );
    pendingHistoryWriteRef.current = {
      userId, conversationId, generation: historySessionGeneration,
      snapshot: { conversation, title, messages: [...accumulatedMessagesRef.current],
        hasOlder, olderCursor, hasNewer, newerCursor, unreadBoundaryId,
        focusAnchorId, pinnedMessageId,
        historyMayHaveGaps: historyMayHaveGapsRef.current || hasOlder || hasNewer },
    };
    const timer = setTimeout(flushHistoryWrite, 250);
    return () => clearTimeout(timer);
  }, [conversation, conversationId, focusAnchorId, hasNewer, hasOlder, messages,
    newerCursor, olderCursor, pinnedMessageId, threadHydrated, historyUnavailableOffline,
    title, unreadBoundaryId, user?.id, historySessionGeneration, flushHistoryWrite]);
  useEffect(() => () => { flushHistoryWrite(); }, [conversationId, user?.id, flushHistoryWrite]);
''')
    text = between(text, '    try {\n      const saved = await outbox.send(', '\n  const startReply =', '''    try {
      const queued = await outbox.queue(pending);
      if (!isCurrentSendScope()) return;
      if (getNativeChatQueueState(queued.message) !== 'cancelled') onPersisted?.();
      setMessages((current) => mergeMessages(current, queued.message, user?.id));
    } catch (cause) {
      if (!isCurrentSendScope()) return;
      setMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, local_status: 'failed' } : message
      )));
      Alert.alert('Не удалось сохранить сообщение',
        formatApiError(cause, 'Текст остался в поле ввода. Сообщение не поставлено в очередь.'));
    }
  }, [isCurrentSendScope, conversationId, outbox, requestBottomAnchor, stopOutgoingTyping, user]);
''')
    text = between(text, '    let uploadPrepared = false;', '\n  const sendPickedFile =', '''    try {
      const queued = await outbox.queue(pending, upload);
      if (!isCurrentSendScope()) return;
      const durableUpload = queued.upload;
      if (!durableUpload) throw new Error('Не удалось восстановить сохранённое вложение');
      pendingAttachmentUploadsRef.current.set(clientMessageId, durableUpload);
      setMessages((current) => mergeMessages(current, queued.message, user?.id));
      clearAttachmentTransfersForIds(attachmentIds);
      if (getNativeChatQueueState(queued.message) !== 'cancelled'
        && !previousUpload && composerRevision === textRevisionRef.current) {
        setText('');
        setComposerMode(null);
        setAttachmentDraftFiles([]);
        if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
      }
    } catch (cause) {
      if (!isCurrentSendScope()) return;
      const cancelled = controller.signal.aborted;
      setMessages((current) => current.map((message) => message.id === pending.id
        ? { ...message, local_status: cancelled ? 'cancelled' : 'failed' } : message));
      setAttachmentTransfersForIds(attachmentIds, {
        action: 'upload', progress: 0, status: cancelled ? 'cancelled' : 'failed', cancellable: false,
      });
      if (!cancelled) {
        void recordDiagnosticEvent('native_file_error');
        Alert.alert('Не удалось сохранить вложение', formatApiError(cause,
          'Файл не поставлен в очередь. Повторите сохранение на устройстве.'));
      }
    } finally {
      if (uploadControllersRef.current.get(clientMessageId) === controller) {
        uploadControllersRef.current.delete(clientMessageId);
      }
    }
  }, [isCurrentSendScope, clearAttachmentTransfersForIds, composerMode, conversationId,
    outbox, requestBottomAnchor, setAttachmentTransfersForIds, stopOutgoingTyping, text, user]);
''')
    rep('    uploadControllersRef.current.get(clientMessageId)?.abort();\n  }, []);', '''    uploadControllersRef.current.get(clientMessageId)?.abort();
    void outbox.cancelDelivery(clientMessageId).catch(() => {
      if (mountedRef.current) Alert.alert('Не удалось отменить отправку', 'Повторите действие.');
    });
  }, [outbox]);''')
    rep('    const pending = pendingAttachmentUploadsRef.current.get(clientMessageId);\n    if (!clientMessageId || !pending) return;', '''    if (clientMessageId && getNativeChatQueueState(message)) {
      void outbox.retryDelivery(clientMessageId).catch(() => {
        if (mountedRef.current) Alert.alert('Не удалось повторить отправку', 'Дождитесь завершения текущей операции.');
      });
      return;
    }
    const pending = pendingAttachmentUploadsRef.current.get(clientMessageId);
    if (!clientMessageId || !pending) return;''')
    rep('  }, [sendPickedFiles]);\n\n  const pickAndSendAttachment', '  }, [outbox, sendPickedFiles]);\n\n  const pickAndSendAttachment')
    rep("        awaitingConnection={actions.offlineMode && item.local_status === 'failed'}", "        awaitingConnection={['queued', 'retry'].includes(getNativeChatQueueState(item) || '')}")
    rep('          ? (actions.offlineMode\n            ? undefined', "          ? (['queued', 'retry'].includes(getNativeChatQueueState(item) || '')\n            ? undefined")
    rep('        {canWrite ? (', '        {canCompose ? (')
    rep("            canRecord={canWrite && composerMode?.type !== 'edit'}", "            canRecord={canCompose && composerMode?.type !== 'edit'}")
    rep('|${canWrite}|${highlightedMessageId', '|${canWrite}|${offlineMode}|${highlightedMessageId')
    rep('        onSwipeReply={actions.canWrite &&', '        onSwipeReply={canCompose &&')
    rep('  }, [finishMessageEnterMotion, reduceMotion, rowDecorations, styles]);', '  }, [canCompose, finishMessageEnterMotion, reduceMotion, rowDecorations, styles]);')
    rep('  const jumpToBottom = useCallback(async () => {\n    if (!hasNewer)', '''  const jumpToBottom = useCallback(async () => {
    if (offlineMode) {
      const local = mergeMessages(accumulatedMessagesRef.current, messages, user?.id);
      if (!local.length) return;
      setMessages(local);
      setFocusAnchorId(local[0].id);
      setShowJumpToBottom(false);
      setNewMessageCount(0);
      return;
    }
    if (!hasNewer)''')
    rep('  }, [conversationId, hasNewer, markRead, messages, reduceMotion, user?.id]);', '  }, [conversationId, hasNewer, markRead, messages, offlineMode, reduceMotion, user?.id]);')
    rep('    setSearching(true);\n    try {\n      const page = await chatApi.getThreadBootstrap', '''    if (offlineMode) {
      Alert.alert('Сообщение не сохранено', 'Для загрузки этого участка переписки нужно подключение.');
      return;
    }
    setSearching(true);
    try {
      const page = await chatApi.getThreadBootstrap''')
    rep('  const [searchCompleted, setSearchCompleted] = useState(false);', '''  const [searchCompleted, setSearchCompleted] = useState(false);
  const searchRequestRef = useRef(0);
  useEffect(() => {
    searchRequestRef.current += 1;
    setSearching(false);
    return () => { searchRequestRef.current += 1; };
  }, [searchQuery, searchOpen, offlineMode, conversationId, user?.id]);''')
    rep('    const query = searchQuery.trim();\n    if (!query || searching) return;', '''    const query = searchQuery.trim();
    if (!query || searching) return;
    const request = ++searchRequestRef.current;
    const currentSearch = () => mountedRef.current && searchRequestRef.current === request;''')
    a = text.index('  const runSearch =')
    b = text.index('  const focusSearchResult =', a)
    section = text[a:b].replace('if (mountedRef.current)', 'if (currentSearch())')
    text = text[:a] + section + text[b:]
    return text

def app_lock(text: str) -> str:
    text = replace_once(text, 'useCallback, useEffect, useMemo', 'useCallback, useEffect, useLayoutEffect, useMemo')
    text = replace_once(text, "import { useAuth } from './AuthContext';", "import { useAuth } from './AuthContext';\nimport { setNativeChatDeliveryBlocked } from '../chat/nativeChatDeliveryGate';")
    text = replace_once(text, '  const [locked, setLocked] = useState(false);', '''  const [locked, setLocked] = useState(false);
  useLayoutEffect(() => {
    setNativeChatDeliveryBlocked(!user || locked);
    return () => setNativeChatDeliveryBlocked(true);
  }, [user?.id, locked]);''')
    return replace_once(text, '          setLocked(true);', '          setNativeChatDeliveryBlocked(true);\n          setLocked(true);')

def route(text: str) -> str:
    text = replace_once(text, "import { NATIVE_CHAT_ENABLED }", "import { useAuth } from '../../../src/auth/AuthContext';\nimport { NATIVE_CHAT_ENABLED }")
    text = replace_once(text, '  const { conversationId, messageId }', '  const { user } = useAuth();\n  const { conversationId, messageId }')
    return replace_once(text, 'key={id}', 'key={`${Number(user?.id || 0)}:${id}`}')

def inbox(text: str) -> str:
    text = replace_once(text, '    const query = search.trim();\n    if (!query || workspace', '    const requestId = ++searchRequestRef.current;\n    const query = search.trim();\n    if (!query || workspace')
    text = replace_once(text, '    const requestId = ++searchRequestRef.current;\n    setSearching(true);', '    setSearching(true);')
    return text

def outbox_screen(text: str) -> str:
    text = replace_once(text, "import * as chatApi from '../../api/chatApi';\n", '')
    text = replace_once(text, "import { buildAttachmentsFormData } from '../../files/nativeFilePicker';\n", '')
    text = replace_once(text, "const canSend = hasPermission('chat.write') && !offlineMode;", "const canSend = hasPermission('chat.write');")
    text = between(text, '  const run = useCallback(', '\n  const discard =', """  const run = useCallback(async (row: Row, discard = false) => {
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
""")
    text = replace_once(text, "type Row = NativeChatOutboxEntry & { busy: boolean };", """type Row = NativeChatOutboxEntry & { busy: boolean };
function deliveryLabel(row: Row) {
  if (row.delivery?.confirmed) return 'Отправлено. Сохраняется в истории';
  if (row.busy) return 'Отправляется…';
  if (row.delivery?.state === 'queued') return 'Ожидает доставки';
  if (row.delivery?.state === 'retry') return 'Связь прервалась. Ожидает повтора';
  if (row.delivery?.state === 'cancelled') return 'Отправка отменена';
  return 'Ожидает ручного повтора';
}""")
    text = replace_once(text, 'Для повторной отправки подключитесь к сети.', 'Новые сообщения отправятся после подключения, пока приложение открыто и разблокировано. Старые ошибки требуют ручного повтора.')
    text = replace_once(text, "{item.busy || busyId === `${item.message.conversation_id}:${item.message.client_message_id}` ? 'Выполняется…' : 'Ожидает повтора'}", '{deliveryLabel(item)}')
    text = replace_once(text, 'disabled={!canSend || item.busy || Boolean(busyId)}', "disabled={!canSend || item.busy || Boolean(busyId) || Boolean(item.delivery?.confirmed) || ['queued', 'retry'].includes(item.delivery?.state || '')}")
    text = replace_once(text, 'disabled={item.busy || Boolean(busyId)}', 'disabled={item.busy || Boolean(busyId) || Boolean(item.delivery?.confirmed)}')
    text = replace_once(text, '<View style={styles.actions}>', """<View style={styles.actions}>
            {item.delivery && ['queued', 'retry', 'sending'].includes(item.delivery.state) ? <Pressable
              accessibilityRole="button" accessibilityLabel="Отменить доставку" disabled={Boolean(busyId)} style={styles.action}
              onPress={() => cancel(item)}><Text style={{ color: tokens.textSecondary }}>Отменить</Text></Pressable> : null}
            {item.delivery?.replyMissing ? <Pressable accessibilityRole="button" accessibilityLabel="Отправить без цитаты"
              disabled={!canSend || item.busy || Boolean(busyId)} style={styles.action}
              onPress={() => withoutQuote(item)}><Text style={{ color: tokens.composerActionBg }}>Без цитаты</Text></Pressable> : null}""")
    return text

def host(text: str) -> str:
    text = replace_once(text, "import { chatSocket } from './chatSocket';", "import { chatSocket } from './chatSocket';\nimport { NATIVE_CHAT_ENABLED } from './nativeChatFeature';")
    return replace_once(text, "const allowed = hasPermission('chat.read')", "const allowed = NATIVE_CHAT_ENABLED && hasPermission('chat.read')")

TRANSFORMS = [thread, app_lock, route, outbox_screen, host, inbox]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    prepared = []
    for (name, expected), transform in zip(EXPECTED.items(), TRANSFORMS):
        path = ROOT / name
        raw = path.read_bytes()
        if git_sha(raw) != expected:
            raise SystemExit(f'Refusing to overwrite changed source: {name}')
        changed = transform(raw.decode('utf-8')).encode('utf-8')
        prepared.append((path, changed))
        print(f'{name}: {expected} -> {git_sha(changed)}')
    for path in (ROOT / 'mobile-hub/src/screens/chat').glob('*.test.tsx'):
        source = path.read_text(encoding='utf-8')
        changed = source.replace("import { NativeChatThreadScreen } from './NativeChatThreadScreen';",
            "import { NativeChatThreadWithDelivery as NativeChatThreadScreen } from '../../test/NativeChatWithDelivery';")
        changed = changed.replace("import { NativeChatOutboxScreen } from './NativeChatOutboxScreen';",
            "import { NativeChatOutboxWithDelivery as NativeChatOutboxScreen } from '../../test/NativeChatWithDelivery';")
        if path.name == 'NativeChatScreens.test.tsx':
            changed = replace_once(changed, "let mockChatWriteAllowed = true;", "let mockChatWriteAllowed = true;\nconst mockThreadSnapshots = new Map<string, unknown>();")
            changed = replace_once(changed,
                "    jest.mocked(nativeSnapshotCache.readNativeEntitySnapshot).mockResolvedValue(null);\n    jest.mocked(nativeSnapshotCache.writeNativeEntitySnapshot).mockResolvedValue(undefined);",
                """    mockThreadSnapshots.clear();
    jest.mocked(nativeSnapshotCache.readNativeEntitySnapshot).mockImplementation(async (scope, userId, id) => {
      const data = mockThreadSnapshots.get(JSON.stringify([scope, userId, id]));
      return (data ? { savedAt: Date.now(), data } : null) as never;
    });
    jest.mocked(nativeSnapshotCache.writeNativeEntitySnapshot).mockImplementation(async (scope, userId, id, data) => {
      mockThreadSnapshots.set(JSON.stringify([scope, userId, id]), JSON.parse(JSON.stringify(data)));
    });""")
        if changed != source:
            prepared.append((path, changed.encode('utf-8')))
            print(f'{path.relative_to(ROOT)}: compose real delivery host in test')
    if args.apply:
        for path, data in prepared:
            path.write_bytes(data)
        print('Applied source-only changes. Run project checks; no commit/deployment performed.')
    else:
        print('Dry run only. Use --apply in a clean worktree to write these changes.')

if __name__ == '__main__':
    main()
