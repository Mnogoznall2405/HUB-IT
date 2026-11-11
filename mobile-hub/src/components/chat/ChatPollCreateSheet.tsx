import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useChatTokens } from '../../theme/chatTokens';
import { ChatInlineSheet } from './ChatInlineSheet';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

/** F-POLL: create-poll sheet — question plus 2..10 options, sent as kind='poll'. */
export function ChatPollCreateSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[], anonymous: boolean) => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  // Telegram polls are anonymous by default.
  const [anonymous, setAnonymous] = useState(true);
  const canCreate = question.trim().length > 0
    && options.filter((item) => item.trim()).length >= MIN_OPTIONS;

  const updateOption = useCallback((index: number, value: string) => {
    setOptions((items) => items.map((item, i) => (i === index ? value : item)));
  }, []);

  const addOption = useCallback(() => {
    setOptions((items) => (items.length < MAX_OPTIONS ? [...items, ''] : items));
  }, []);

  const removeOption = useCallback((index: number) => {
    setOptions((items) => (items.length > MIN_OPTIONS ? items.filter((_, i) => i !== index) : items));
  }, []);

  const create = useCallback(() => {
    if (!canCreate) return;
    onCreate(question.trim(), options.map((item) => item.trim()).filter(Boolean), anonymous);
    setQuestion('');
    setOptions(['', '']);
    setAnonymous(true);
  }, [anonymous, canCreate, onCreate, options, question]);

  const close = useCallback(() => {
    setQuestion('');
    setOptions(['', '']);
    setAnonymous(true);
    onClose();
  }, [onClose]);

  return (
    <ChatInlineSheet
      visible={visible}
      onClose={close}
      dismissAccessibilityLabel="Закрыть опрос"
      sheetStyle={styles.sheet}
      contentStyle={styles.content}
    >
      <Text style={styles.title}>Новый опрос</Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <TextInput
          style={styles.input}
          placeholder="Вопрос"
          placeholderTextColor={chatTokens.textSecondary}
          value={question}
          onChangeText={setQuestion}
          maxLength={300}
          accessibilityLabel="Вопрос опроса"
        />
        {options.map((option, index) => (
          <View key={index} style={styles.optionRow}>
            <TextInput
              style={[styles.input, styles.optionInput]}
              placeholder={`Вариант ${index + 1}`}
              placeholderTextColor={chatTokens.textSecondary}
              value={option}
              onChangeText={(value) => updateOption(index, value)}
              maxLength={100}
              accessibilityLabel={`Вариант ${index + 1}`}
            />
            {options.length > MIN_OPTIONS ? (
              <Pressable
                onPress={() => removeOption(index)}
                style={styles.removeOption}
                accessibilityLabel={`Удалить вариант ${index + 1}`}
                accessibilityRole="button"
              >
                <Text style={styles.removeOptionText}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {options.length < MAX_OPTIONS ? (
          <Pressable onPress={addOption} style={styles.addOption} accessibilityRole="button">
            <Text style={styles.addOptionText}>+ Вариант</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.anonRow}
          onPress={() => setAnonymous((value) => !value)}
          accessibilityRole="switch"
          accessibilityState={{ checked: anonymous }}
          accessibilityLabel="Анонимный опрос"
        >
          <Text style={styles.anonText}>Анонимный опрос</Text>
          <View style={[styles.anonSwitch, anonymous && styles.anonSwitchOn]}>
            <View style={[styles.anonKnob, anonymous && styles.anonKnobOn]} />
          </View>
        </Pressable>
      </ScrollView>
      <Pressable
        onPress={create}
        disabled={!canCreate}
        style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Создать опрос"
      >
        <Text style={styles.createButtonText}>Создать</Text>
      </Pressable>
    </ChatInlineSheet>
  );
}

function createStyles(chatTokens: ReturnType<typeof useChatTokens>) {
  return StyleSheet.create({
    // Opaque bottom sheet (ChatBottomSheet supplies the background); height
    // follows content, capped so the keyboard + fields stay visible.
    sheet: { maxHeight: '78%' },
    content: {
      paddingHorizontal: 16,
      paddingBottom: 20,
    },
    title: {
      color: chatTokens.textPrimary,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 12,
    },
    scroll: { flexGrow: 0 },
    input: {
      borderRadius: 10,
      backgroundColor: chatTokens.sidebarSearchBg,
      color: chatTokens.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      marginTop: 8,
    },
    optionRow: { flexDirection: 'row', alignItems: 'center' },
    optionInput: { flex: 1 },
    removeOption: {
      marginLeft: 6,
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeOptionText: { color: chatTokens.textSecondary, fontSize: 22 },
    addOption: { paddingVertical: 12 },
    addOptionText: { color: chatTokens.composerActionBg, fontSize: 14, fontWeight: '600' },
    anonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      marginTop: 4,
    },
    anonText: { color: chatTokens.textPrimary, fontSize: 15 },
    anonSwitch: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: chatTokens.sidebarSearchBg,
      justifyContent: 'center',
      padding: 2,
    },
    anonSwitchOn: { backgroundColor: chatTokens.composerActionBg },
    anonKnob: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#fff',
    },
    anonKnobOn: { alignSelf: 'flex-end' },
    createButton: {
      marginTop: 12,
      borderRadius: 10,
      backgroundColor: chatTokens.composerActionBg,
      paddingVertical: 12,
      alignItems: 'center',
    },
    createButtonDisabled: { opacity: 0.4 },
    createButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  });
}
