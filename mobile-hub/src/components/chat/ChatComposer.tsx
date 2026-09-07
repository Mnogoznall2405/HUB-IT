import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type VoiceHoldGesture, voiceHoldHintLabel } from '../../chat/chatVoice';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { ChatComposerContext } from './ChatComposerContext';
import { ChatVoiceRecordingMeter } from './ChatVoiceRecordingMeter';

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void | Promise<void>;
  placeholder?: string;
  mode?: 'reply' | 'edit' | null;
  contextLabel?: string;
  contextPreview?: string;
  onCancelMode?: () => void;
  onOpenContext?: () => void;
  busy?: boolean;
  onAttachmentPress?: () => void;
  onEmojiPress?: () => void;
  uploadLabel?: string;
  uploadProgress?: number | null;
  onLayout?: (event: LayoutChangeEvent) => void;
  voiceRecording?: boolean;
  voiceDurationLabel?: string;
  voiceLevel?: number | null;
  onMicPress?: () => void;
  onMicHoldStart?: () => void;
  onMicHoldMove?: (dx: number, dy: number) => void;
  onMicHoldRelease?: () => void;
  voiceHoldLocked?: boolean;
  voiceHoldHint?: VoiceHoldGesture;
  onCancelVoice?: () => void;
  onSendVoice?: () => void;
};

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  placeholder = 'Сообщение',
  mode = null,
  contextLabel,
  contextPreview,
  onCancelMode,
  onOpenContext,
  busy = false,
  onAttachmentPress,
  onEmojiPress,
  uploadLabel,
  uploadProgress,
  onLayout,
  voiceRecording = false,
  voiceDurationLabel = '0:00',
  voiceLevel = null,
  onMicPress,
  onMicHoldStart,
  onMicHoldMove,
  onMicHoldRelease,
  voiceHoldLocked = true,
  voiceHoldHint = 'record',
  onCancelVoice,
  onSendVoice,
}: Props) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const reduceMotion = useReducedMotion();
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (mode) inputRef.current?.focus();
  }, [mode]);
  const inputHeight = useRef(new Animated.Value(44)).current;
  const targetHeightRef = useRef(44);
  useEffect(() => () => inputHeight.stopAnimation(), [inputHeight]);
  const resizeInput = (height: number) => {
    const next = Math.min(120, Math.max(44, Math.ceil(height)));
    if (next === targetHeightRef.current) return;
    targetHeightRef.current = next;
    inputHeight.stopAnimation();
    if (reduceMotion) { inputHeight.setValue(next); return; }
    Animated.timing(inputHeight, { toValue: next, duration: 160, useNativeDriver: false }).start();
  };
  const holdOrigin = useRef({ x: 0, y: 0 });
  const sentValueRef = useRef<symbol | null>(null);
  const hasText = Boolean(value.trim());
  const showMic = Boolean(onMicPress) && !hasText && mode !== 'edit' && !voiceRecording;
  const sendDisabled = voiceRecording ? busy : (!hasText || busy);
  const uploadPercent = uploadProgress == null
    ? null
    : Math.round(Math.max(0, Math.min(1, uploadProgress)) * 100);

  useEffect(() => { sentValueRef.current = null; }, [value, mode]);
  const handleSendPress = () => {
    if (busy || !hasText || sentValueRef.current) return;
    const attempt = Symbol('send');
    sentValueRef.current = attempt;
    const release = () => { if (sentValueRef.current === attempt) sentValueRef.current = null; };
    try {
      const pending = onSend();
      if (pending) void pending.then(release, release);
    } catch (error) { release(); throw error; }
  };
  return (
    <View style={styles.dock} onLayout={onLayout}>
      <ChatComposerContext mode={voiceRecording ? null : mode} label={contextLabel} preview={contextPreview} onCancel={onCancelMode} onOpen={onOpenContext} busy={busy} />
      {uploadLabel ? (
        <View style={styles.upload} accessibilityLiveRegion="polite">
          <Text style={styles.uploadLabel} numberOfLines={1}>{uploadLabel}</Text>
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={uploadLabel}
            accessibilityValue={uploadPercent == null
              ? { text: 'Выполняется' }
              : {
                min: 0,
                max: 100,
                now: uploadPercent,
                text: `${uploadPercent} процентов`,
              }}
          >
            <View
              style={[
                styles.progressValue,
                { width: `${uploadPercent || 0}%` },
              ]}
            />
          </View>
        </View>
      ) : null}
      <View style={styles.composer}>
        {voiceRecording ? (
          <>
            <Pressable
              onPress={onCancelVoice}
              disabled={busy}
              style={({ pressed }) => [styles.cancelVoiceBtn, pressed && styles.sendBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Отменить запись"
            >
              <MaterialCommunityIcons name="close" size={22} color={chatTokens.dangerText} />
            </Pressable>
            <View
              style={styles.recordingShell}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Запись голосового сообщения ${voiceDurationLabel}`}
            >
              <ChatVoiceRecordingMeter level={voiceLevel} />
              <View style={styles.recordingMeta}>
                <Text style={styles.recordingLabel}>{voiceDurationLabel}</Text>
                {!voiceHoldLocked ? (
                  <Text
                    style={[
                      styles.holdHint,
                      voiceHoldHint === 'cancel' && styles.holdHintCancel,
                      voiceHoldHint === 'lock' && styles.holdHintLock,
                    ]}
                  >
                    {voiceHoldHintLabel(voiceHoldHint)}
                  </Text>
                ) : null}
              </View>
            </View>
            {voiceHoldLocked ? (
              <Pressable
                onPress={onSendVoice}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sendBtn,
                  busy && styles.sendBtnDisabled,
                  pressed && !busy && styles.sendBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Отправить голосовое"
                accessibilityState={{ disabled: busy, busy }}
              >
                <MaterialCommunityIcons name="send" size={22} color={chatTokens.composerActionText} />
              </Pressable>
            ) : (
              <View style={styles.holdLockBadge} accessibilityElementsHidden>
                <MaterialCommunityIcons
                  name={voiceHoldHint === 'lock' ? 'lock' : 'lock-outline'}
                  size={18}
                  color={voiceHoldHint === 'lock' ? chatTokens.accentText : chatTokens.textSecondary}
                />
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.inputShell}>
              {onEmojiPress ? (
                <Pressable
                  onPress={onEmojiPress}
                  disabled={busy}
                  style={({ pressed }) => [styles.emojiButton, pressed && styles.sendBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Открыть эмодзи"
                >
                  <MaterialCommunityIcons name="emoticon-outline" size={24} color={chatTokens.textSecondary} />
                </Pressable>
              ) : null}
              <AnimatedInput
                ref={inputRef}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={chatTokens.textSecondary}
                accessibilityLabel="Текст сообщения"
                style={[styles.input, { height: inputHeight }]}
                onContentSizeChange={(event) => resizeInput(event.nativeEvent.contentSize.height)}
                multiline
                maxLength={10000}
                editable={!busy}
              />
              {onAttachmentPress ? (
                <Pressable
                  onPress={onAttachmentPress}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.attachmentButton,
                    busy && styles.sendBtnDisabled,
                    pressed && !busy && styles.sendBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Добавить вложение"
                  accessibilityState={{ disabled: busy }}
                >
                  <MaterialCommunityIcons name="paperclip" size={25} color={chatTokens.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                sendDisabled && styles.sendBtnDisabled,
                pressed && !sendDisabled && styles.sendBtnPressed,
              ]}
              onPress={showMic ? onMicPress : handleSendPress}
              onPressIn={showMic ? (event) => {
                holdOrigin.current = {
                  x: event.nativeEvent.pageX || 0,
                  y: event.nativeEvent.pageY || 0,
                };
                onMicHoldStart?.();
              } : undefined}
              onTouchMove={showMic && onMicHoldMove ? (event) => {
                onMicHoldMove(
                  event.nativeEvent.pageX - holdOrigin.current.x,
                  event.nativeEvent.pageY - holdOrigin.current.y,
                );
              } : undefined}
              onPressOut={showMic ? onMicHoldRelease : undefined}
              disabled={showMic ? busy : sendDisabled}
              accessibilityRole="button"
              accessibilityHint={showMic ? 'Удерживайте, чтобы записать. Влево — отмена, вверх — закрепить' : undefined}
              accessibilityLabel={showMic
                ? 'Записать голосовое'
                : mode === 'edit' ? 'Сохранить изменения' : 'Отправить сообщение'}
              accessibilityState={{ disabled: showMic ? busy : sendDisabled, busy }}
            >
              <MaterialCommunityIcons
                name={showMic ? 'microphone' : mode === 'edit' ? 'check' : 'send'}
                size={22}
                color={chatTokens.composerActionText}
              />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  dock: {
    backgroundColor: chatTokens.composerBg,
  },
  upload: { paddingHorizontal: 14, paddingTop: 8, backgroundColor: chatTokens.composerDockBg },
  uploadLabel: { marginBottom: 6, color: chatTokens.textSecondary, fontSize: 12 },
  progressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: chatTokens.borderSoft,
  },
  progressValue: { height: 3, borderRadius: 2, backgroundColor: chatTokens.composerActionBg },
  composer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    paddingHorizontal: 7,
    paddingTop: 6,
    paddingBottom: 7,
  },
  inputShell: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: chatTokens.composerInputBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    elevation: 1,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 10,
    fontSize: 16,
    color: chatTokens.textPrimary,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: chatTokens.composerActionBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButton: {
    width: 42,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelVoiceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerDockBg,
  },
  recordingShell: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: chatTokens.composerInputBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
  },
  recordingMeta: { flex: 1, minWidth: 0 },
  recordingLabel: { color: chatTokens.dangerText, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  holdHint: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 12, fontWeight: '600' },
  holdHintCancel: { color: chatTokens.dangerText },
  holdHintLock: { color: chatTokens.accentText },
  holdLockBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  sendBtnDisabled: { opacity: 0.45 },
});
