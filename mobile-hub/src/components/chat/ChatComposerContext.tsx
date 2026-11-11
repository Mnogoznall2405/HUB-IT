import { Pressable, Text, View } from 'react-native';
import { useChatTokens } from '../../theme/chatTokens';

type Context = { mode: 'reply' | 'edit' | null; label?: string; preview?: string };

/** Reply/edit plate above the input. Appears and disappears instantly (Telegram
 * style): an animated height ran on the JS thread, right while the thread
 * re-rendered for the reply, and made the plate crawl in. */
export function ChatComposerContext({ mode, label, preview, onCancel, onOpen, busy = false }: Context & {
  onCancel?: () => void;
  onOpen?: () => void;
  busy?: boolean;
}) {
  const tokens = useChatTokens();
  if (!mode) return null;
  return (
    <View testID="chat-composer-context"
      style={{ minHeight: 56, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable disabled={!onOpen} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Перейти к исходному сообщению"
        style={{ flex: 1, minWidth: 0, borderLeftWidth: 3, borderLeftColor: tokens.accentText, paddingLeft: 8 }}>
        <Text numberOfLines={1} style={{ color: tokens.accentText, fontWeight: '700' }}>{mode === 'edit' ? 'Редактирование' : label || 'Ответ'}</Text>
        <Text numberOfLines={2} style={{ color: tokens.textSecondary }}>{preview || 'Сообщение'}</Text>
      </Pressable>
      <Pressable onPress={onCancel} disabled={busy} accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel={mode === 'edit' ? 'Отменить редактирование' : 'Отменить ответ'}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: tokens.textSecondary, fontSize: 24 }}>×</Text>
      </Pressable>
    </View>
  );
}
