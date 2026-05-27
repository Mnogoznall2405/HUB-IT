import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from 'react-native-paper';
import { chatTokens } from '../../theme/chatTokens';

type ChatUser = { id: number; username: string; full_name?: string };
type AiBot = { id: string; name: string };

export function NewChatSheet({
  visible,
  users,
  bots,
  onClose,
  onDirect,
  onGroup,
  onBot,
}: {
  visible: boolean;
  users: ChatUser[];
  bots: AiBot[];
  onClose: () => void;
  onDirect: (userId: number) => void;
  onGroup: (title: string, memberIds: number[]) => void;
  onBot: (botId: string) => void;
}) {
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [query, setQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = `${u.full_name || ''} ${u.username}`.toLowerCase();
      return name.includes(q) || String(u.id).includes(q);
    });
  }, [users, query]);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const reset = () => {
    setMode('direct');
    setQuery('');
    setGroupTitle('');
    setSelected([]);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={reset}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Новый диалог</Text>
          <View style={styles.modeRow}>
            {(['direct', 'group'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
              >
                <Text style={mode === m ? styles.modeTextActive : styles.modeText}>
                  {m === 'direct' ? 'Личный' : 'Группа'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            placeholder="Поиск по имени или логину"
            value={query}
            onChangeText={setQuery}
            style={styles.search}
            placeholderTextColor={chatTokens.textSecondary}
          />
          <ScrollView style={styles.list}>
            {mode === 'group' ? (
              <TextInput
                placeholder="Название группы"
                value={groupTitle}
                onChangeText={setGroupTitle}
                style={styles.search}
              />
            ) : null}
            {filtered.map((user) => {
              const label = user.full_name || user.username;
              const picked = selected.includes(user.id);
              return (
                <Pressable
                  key={user.id}
                  onPress={() => {
                    if (mode === 'direct') onDirect(user.id);
                    else toggle(user.id);
                  }}
                  style={[styles.userRow, picked && styles.userRowSelected]}
                >
                  <Text style={styles.userName}>
                    {mode === 'group' && picked ? '✓ ' : ''}
                    {label}
                  </Text>
                  <Text style={styles.userMeta}>@{user.username}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.section}>AI-боты</Text>
            {bots.map((bot) => (
              <Pressable key={bot.id} onPress={() => onBot(bot.id)} style={styles.userRow}>
                <Text style={styles.userName}>🤖 {bot.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {mode === 'group' ? (
            <Button
              mode="contained"
              onPress={() => {
                if (groupTitle.trim()) onGroup(groupTitle.trim(), selected);
              }}
              style={styles.footerBtn}
            >
              Создать группу ({selected.length})
            </Button>
          ) : null}
          <Button onPress={reset}>Закрыть</Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: chatTokens.panelBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '88%',
  },
  title: { fontSize: 20, fontWeight: '700', color: chatTokens.textPrimary, marginBottom: 12 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    flex: 1,
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  userRowSelected: { backgroundColor: chatTokens.sidebarRowSoftActive },
  userName: { fontSize: 16, fontWeight: '600', color: chatTokens.textPrimary },
  userMeta: { fontSize: 13, color: chatTokens.textSecondary, marginTop: 2 },
  section: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    color: chatTokens.textSecondary,
    textTransform: 'uppercase',
  },
  footerBtn: { marginVertical: 8 },
});
