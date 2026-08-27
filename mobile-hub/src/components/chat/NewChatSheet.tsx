import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { ChatUserSummary } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

type AiBot = { id: string; name: string };

export function NewChatSheet({
  visible,
  users,
  bots,
  variant = 'chats',
  onClose,
  onDirect,
  onSearchUsers,
  onGroup,
  onBot,
  onGeneralAi,
}: {
  visible: boolean;
  users: ChatUserSummary[];
  bots: AiBot[];
  variant?: 'chats' | 'ai';
  onClose: () => void;
  onDirect: (userId: number) => void | Promise<void>;
  onSearchUsers?: (query: string) => Promise<ChatUserSummary[]>;
  onGroup: (title: string, memberIds: number[]) => void | Promise<void>;
  onBot: (botId: string) => void | Promise<void>;
  onGeneralAi?: () => void | Promise<void>;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [query, setQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<ChatUserSummary[] | null>(null);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userSearchError, setUserSearchError] = useState('');

  useEffect(() => {
    if (visible) return;
    setMode('direct');
    setQuery('');
    setGroupTitle('');
    setSelected([]);
    setBusy(false);
    setRemoteUsers(null);
    setSearchingUsers(false);
    setUserSearchError('');
  }, [visible]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!visible || variant !== 'chats' || !normalizedQuery || !onSearchUsers) {
      setRemoteUsers(null);
      setSearchingUsers(false);
      setUserSearchError('');
      return;
    }

    let active = true;
    setRemoteUsers(null);
    setSearchingUsers(true);
    setUserSearchError('');
    const timer = setTimeout(() => {
      void onSearchUsers(normalizedQuery)
        .then((items) => {
          if (!active) return;
          setRemoteUsers(items);
          setSearchingUsers(false);
        })
        .catch(() => {
          if (!active) return;
          setUserSearchError('Не удалось выполнить поиск по каталогу. Повторите попытку.');
          setSearchingUsers(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [onSearchUsers, query, variant, visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q && remoteUsers !== null ? remoteUsers : users;
    if (!q) return source;
    return source.filter((u) => {
      const name = `${u.full_name || ''} ${u.username} ${u.corporate_email || ''}`.toLowerCase();
      return name.includes(q) || String(u.id).includes(q);
    });
  }, [query, remoteUsers, users]);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const reset = () => {
    if (busy) return;
    setMode('direct');
    setQuery('');
    setGroupTitle('');
    setSelected([]);
    setRemoteUsers(null);
    setSearchingUsers(false);
    setUserSearchError('');
    onClose();
  };

  const runCreate = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={reset}>
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{variant === 'ai' ? 'Новый AI-чат' : 'Новый диалог'}</Text>
          {variant === 'ai' ? (
            <>
              <Text style={styles.aiHint}>
                Выберите помощника. Для каждого нового чата создаётся отдельная история.
              </Text>
              <ScrollView style={styles.list}>
                {onGeneralAi ? (
                  <Pressable
                    disabled={busy}
                    onPress={() => { void runCreate(onGeneralAi); }}
                    style={[styles.userRow, busy && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Открыть HUB Ассистент"
                    accessibilityState={{ disabled: busy }}
                  >
                    <Text style={styles.userName}>HUB Ассистент</Text>
                    <Text style={styles.userMeta}>Общение, база знаний, файлы и документы</Text>
                  </Pressable>
                ) : null}
                {bots.map((bot) => (
                  <Pressable
                    key={bot.id}
                    disabled={busy}
                    onPress={() => { void runCreate(() => onBot(bot.id)); }}
                    style={[styles.userRow, busy && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть диалог с ботом ${bot.name}`}
                    accessibilityState={{ disabled: busy }}
                  >
                    <Text style={styles.userName}>{bot.name}</Text>
                    <Text style={styles.userMeta}>Корпоративный помощник HUB</Text>
                  </Pressable>
                ))}
                {!bots.length ? (
                  <Text style={styles.empty}>Корпоративные помощники пока недоступны.</Text>
                ) : null}
              </ScrollView>
              {busy ? <Text accessibilityLiveRegion="polite" style={styles.busy}>Открываем диалог…</Text> : null}
              <Button disabled={busy} onPress={reset}>Закрыть</Button>
            </>
          ) : (
            <>
          <View style={styles.modeRow}>
            {(['direct', 'group'] as const).map((m) => (
              <Pressable
                key={m}
                disabled={busy}
                onPress={() => setMode(m)}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive, busy && styles.disabled]}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === m, disabled: busy }}
                accessibilityLabel={m === 'direct' ? 'Личный диалог' : 'Групповой диалог'}
              >
                <Text style={mode === m ? styles.modeTextActive : styles.modeText}>
                  {m === 'direct' ? 'Личный' : 'Группа'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            placeholder="Поиск по имени, логину или почте"
            value={query}
            onChangeText={setQuery}
            editable={!busy}
            style={styles.search}
            placeholderTextColor={chatTokens.textSecondary}
            accessibilityLabel="Поиск пользователей"
          />
          {searchingUsers ? (
            <Text accessibilityLiveRegion="polite" style={styles.busy}>Ищем в каталоге…</Text>
          ) : null}
          {userSearchError ? (
            <Text accessibilityLiveRegion="polite" style={styles.searchError}>{userSearchError}</Text>
          ) : null}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {mode === 'group' ? (
              <TextInput
                placeholder="Название группы"
                value={groupTitle}
                onChangeText={setGroupTitle}
                editable={!busy}
                style={styles.search}
                accessibilityLabel="Название группы"
                placeholderTextColor={chatTokens.textSecondary}
              />
            ) : null}
            {filtered.map((user) => {
              const label = user.full_name || user.username;
              const picked = selected.includes(user.id);
              return (
                <Pressable
                  key={user.id}
                  disabled={busy}
                  onPress={() => {
                    if (mode === 'direct') void runCreate(() => onDirect(user.id));
                    else toggle(user.id);
                  }}
                  style={[styles.userRow, picked && styles.userRowSelected, busy && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'direct'
                      ? `Открыть диалог с ${label}`
                      : `${picked ? 'Убрать' : 'Добавить'} ${label}`
                  }
                  accessibilityState={{
                    selected: mode === 'group' ? picked : undefined,
                    disabled: busy,
                  }}
                >
                  <Text style={styles.userName}>
                    {mode === 'group' && picked ? '✓ ' : ''}
                    {label}
                  </Text>
                  <Text style={styles.userMeta}>@{user.username}</Text>
                </Pressable>
              );
            })}
            {!filtered.length && !searchingUsers ? <Text style={styles.empty}>Пользователи не найдены</Text> : null}
          </ScrollView>
          {mode === 'group' ? (
            <Button
              mode="contained"
              disabled={busy || !groupTitle.trim() || selected.length === 0}
              onPress={() => {
                if (groupTitle.trim() && selected.length) {
                  void runCreate(() => onGroup(groupTitle.trim(), selected));
                }
              }}
              style={styles.footerBtn}
            >
              {busy ? 'Создаём группу…' : `Создать группу (${selected.length})`}
            </Button>
          ) : null}
          {busy && mode === 'direct' ? (
            <Text accessibilityLiveRegion="polite" style={styles.busy}>Создаём диалог…</Text>
          ) : null}
          <Button disabled={busy} onPress={reset}>Закрыть</Button>
            </>
          )}
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: chatTokens.panelBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '88%',
  },
  title: { fontSize: 20, fontWeight: '700', color: chatTokens.textPrimary, marginBottom: 12 },
  aiHint: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  modeBtnActive: { backgroundColor: chatTokens.composerActionBg },
  modeText: { color: chatTokens.textPrimary },
  modeTextActive: { color: '#fff', fontWeight: '700' },
  search: {
    borderWidth: 1,
    borderColor: chatTokens.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    color: chatTokens.textPrimary,
    backgroundColor: chatTokens.composerInputBg,
  },
  list: { maxHeight: 360 },
  userRow: {
    minHeight: 48,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  userRowSelected: { backgroundColor: chatTokens.sidebarRowSoftActive },
  disabled: { opacity: 0.55 },
  busy: { color: chatTokens.textSecondary, paddingVertical: 8, textAlign: 'center' },
  searchError: { color: chatTokens.dangerText, paddingVertical: 8, textAlign: 'center' },
  userName: { fontSize: 16, fontWeight: '600', color: chatTokens.textPrimary },
  userMeta: { fontSize: 13, color: chatTokens.textSecondary, marginTop: 2 },
  empty: { color: chatTokens.textSecondary, paddingVertical: 12, textAlign: 'center' },
  footerBtn: { marginVertical: 8 },
});
