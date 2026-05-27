import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { chatTokens } from '../../theme/chatTokens';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
};

export function ChatComposer({ value, onChangeText, onSend, placeholder = 'Сообщение' }: Props) {
  return (
    <View style={styles.composer}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        style={styles.input}
        multiline
      />
      <Pressable style={styles.sendBtn} onPress={onSend}>
        <Text style={styles.sendLabel}>➤</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    backgroundColor: chatTokens.composerBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.borderSoft,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: chatTokens.composerInputBg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: chatTokens.composerActionBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { color: chatTokens.composerActionText, fontSize: 18, fontWeight: '700' },
});
