import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { CHAT_MESSAGE_ENTER_DURATION_MS } from './ChatMessageEnterMotion';
import { ChatVoiceRecordingMeter } from './ChatVoiceRecordingMeter';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  mode?: 'reply' | 'edit' | null;
  contextLabel?: string;
  contextPreview?: string;
  onCancelMode?: () => void;
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
  const holdOrigin = useRef({ x: 0, y: 0 });
  const sendGhostProgress = useRef(new Animated.Value(0)).current;
  const sendGhostAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const sendGhostFrameRef = useRef<number | null>(null);
  const sendGhostGenerationRef = useRef(0);
  const [sendGhost, setSendGhost] = useState('');
  const hasText = Boolean(value.trim());
  const showMic = Boolean(onMicPress) && !hasText && mode !== 'edit' && !voiceRecording;
  const sendDisabled = voiceRecording ? busy : (!hasText || busy);
  const uploadPercent = uploadProgress == null
    ? null
    : Math.round(Math.max(0, Math.min(1, uploadProgress)) * 100);

  useEffect(() => () => {
    sendGhostGenerationRef.current += 1;
    sendGhostAnimationRef.current?.stop();
    if (sendGhostFrameRef.current !== null) cancelAnimationFrame(sendGhostFrameRef.current);
  }, []);

  const handleSendPress = () => {
    const snapshot = value.trim();
    if (mode !== 'edit' && snapshot && !busy && !reduceMotion) {
      const generation = ++sendGhostGenerationRef.current;
      sendGhostAnimationRef.current?.stop();
      if (sendGhostFrameRef.current !== null) cancelAnimationFrame(sendGhostFrameRef.current);
      sendGhostProgress.setValue(0);
      setSendGhost(snapshot);
      sendGhostFrameRef.current = requestAnimationFrame(() => {
        sendGhostFrameRef.current = null;
        const animation = Animated.timing(sendGhostProgress, {
          toValue: 1,
          duration: CHAT_MESSAGE_ENTER_DURATION_MS,
          easing: Easing.bezier(0.2, 0.01, 0.28, 0.91),
          useNativeDriver: true,
        });
        sendGhostAnimationRef.current = animation;
        animation.start(() => {
          if (sendGhostGenerationRef.current !== generation) return;
          sendGhostAnimationRef.current = null;
          setSendGhost('');
        });
      });
    }
    onSend();
  };

  const sendGhostOpacity = sendGhostProgress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [0.92, 0.48, 0],
  });
  const sendGhostTranslateY = sendGhostProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -40],
  });
  const sendGhostTranslateX = sendGhostProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 18],
  });
  const sendGhostScale = sendGhostProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.96],
  });
  return (
    <View style={styles.dock} onLayout={onLayout}>
      {mode && !voiceRecording ? (
        <View style={styles.context} accessibilityLiveRegion="polite">
          <View style={styles.contextText}>
            <Text style={styles.contextLabel} numberOfLines={1}>
              {mode === 'edit' ? 'Редактирование' : contextLabel || 'Ответ'}
            </Text>
            <Text style={styles.contextPreview} numberOfLines={1}>
              {contextPreview || 'Сообщение'}
            </Text>
          </View>
          <Pressable
            onPress={onCancelMode}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.sendBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={mode === 'edit' ? 'Отменить редактирование' : 'Отменить ответ'}
          >
            <Text style={styles.cancelLabel}>×</Text>
          </Pressable>
        </View>
      ) : null}
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
        {sendGhost ? (
          <Animated.View
            testID="chat-composer-send-ghost"
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.sendGhost,
              {
                opacity: sendGhostOpacity,
                transform: [
                  { translateY: sendGhostTranslateY },
                  { translateX: sendGhostTranslateX },
                  { scale: sendGhostScale },
                ],
              },
            ]}
          >
            <Text style={styles.sendGhostText} numberOfLines={3}>{sendGhost}</Text>
          </Animated.View>
        ) : null}
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
              <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={chatTokens.textSecondary}
                accessibilityLabel="Текст сообщения"
                style={styles.input}
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
              disabled={sendDisabled && !showMic}
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
  context: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
    backgroundColor: chatTokens.composerDockBg,
  },
  contextText: { flex: 1, minWidth: 0 },
  contextLabel: { color: chatTokens.accentText, fontSize: 13, fontWeight: '700' },
  contextPreview: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 13 },
  cancelButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  cancelLabel: { color: chatTokens.textSecondary, fontSize: 28, lineHeight: 30 },
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
  sendGhost: {
    position: 'absolute',
    left: 56,
    right: 58,
    bottom: 10,
    zIndex: 4,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: chatTokens.bubbleOwnBg,
  },
  sendGhostText: {
    color: chatTokens.bubbleOwnText,
    fontSize: 16,
    lineHeight: 22,
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
