import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, type LayoutChangeEvent } from 'react-native';
import { formatApiError } from '../../api/formatError';
import {
  formatVoiceDuration,
  resolveVoiceHoldGesture,
  resolveVoiceMicRelease,
  type VoiceHoldGesture,
} from '../../chat/chatVoice';
import { NativeMicrophonePermissionError, useNativeVoiceRecorder } from '../../chat/useNativeVoiceRecorder';
import { openAppPermissionSettings, type NativePickedFile } from '../../files/nativeFilePicker';
import { ChatComposer } from './ChatComposer';

type VoiceSendExtra = { mediaKind?: 'image' | 'video' | 'file' | 'audio'; durationSeconds?: number };

export function NativeChatComposerDock({
  value,
  onChangeText,
  onSend,
  placeholder,
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
  canRecord = true,
  onSendVoiceFile,
  onRecordingChange,
  cancelVoiceRef,
  onLayout,
}: {
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
  canRecord?: boolean;
  onSendVoiceFile: (file: NativePickedFile | null, extra?: VoiceSendExtra) => Promise<void>;
  onRecordingChange?: (recording: boolean) => void;
  cancelVoiceRef?: { current: (() => void) | null };
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const {
    voiceRecording,
    voiceRecordingDuration,
    voiceRecordingLevel,
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
    normalizeDuration,
  } = useNativeVoiceRecorder();
  const [voiceHoldLocked, setVoiceHoldLocked] = useState(true);
  const [voiceHoldHint, setVoiceHoldHint] = useState<VoiceHoldGesture>('record');
  const voiceHoldRef = useRef({
    active: false,
    locked: true,
    dx: 0,
    dy: 0,
    startedAt: 0,
  });

  const resetVoiceHold = useCallback(() => {
    voiceHoldRef.current = { active: false, locked: true, dx: 0, dy: 0, startedAt: 0 };
    setVoiceHoldLocked(true);
    setVoiceHoldHint('record');
  }, []);

  useEffect(() => {
    onRecordingChange?.(voiceRecording);
  }, [onRecordingChange, voiceRecording]);

  const cancelVoice = useCallback(() => {
    resetVoiceHold();
    void cancelVoiceRecording();
  }, [cancelVoiceRecording, resetVoiceHold]);

  useEffect(() => {
    if (!cancelVoiceRef) return undefined;
    cancelVoiceRef.current = cancelVoice;
    return () => {
      if (cancelVoiceRef.current === cancelVoice) cancelVoiceRef.current = null;
    };
  }, [cancelVoice, cancelVoiceRef]);

  const startVoice = useCallback(async (locked = true) => {
    if (!canRecord || busy || voiceRecording || mode === 'edit') return;
    voiceHoldRef.current = {
      active: true,
      locked,
      dx: 0,
      dy: 0,
      startedAt: Date.now(),
    };
    setVoiceHoldLocked(locked);
    setVoiceHoldHint('record');
    try {
      await startVoiceRecording();
    } catch (cause) {
      resetVoiceHold();
      if (cause instanceof NativeMicrophonePermissionError) {
        Alert.alert(
          'Нет доступа к микрофону',
          'Разрешите HUB-IT записывать звук в настройках Android.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => void openAppPermissionSettings() },
          ],
        );
      } else {
        Alert.alert('Не удалось начать запись', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [busy, canRecord, mode, resetVoiceHold, startVoiceRecording, voiceRecording]);

  const moveVoiceHold = useCallback((dx: number, dy: number) => {
    if (!voiceHoldRef.current.active || voiceHoldRef.current.locked) return;
    voiceHoldRef.current.dx = dx;
    voiceHoldRef.current.dy = dy;
    setVoiceHoldHint(resolveVoiceHoldGesture(dx, dy));
  }, []);

  const sendVoice = useCallback(async () => {
    const durationSeconds = normalizeDuration(voiceRecordingDuration);
    try {
      const file = await stopVoiceRecording();
      resetVoiceHold();
      await onSendVoiceFile(file, { mediaKind: 'audio', durationSeconds });
    } catch (cause) {
      resetVoiceHold();
      Alert.alert('Не удалось отправить голосовое', formatApiError(cause, 'Повторите попытку'));
    }
  }, [normalizeDuration, onSendVoiceFile, resetVoiceHold, stopVoiceRecording, voiceRecordingDuration]);

  const releaseVoiceHold = useCallback(async () => {
    const hold = voiceHoldRef.current;
    if (!hold.active || hold.locked) return;
    const action = resolveVoiceMicRelease({
      heldMs: Date.now() - hold.startedAt,
      dx: hold.dx,
      dy: hold.dy,
    });
    if (action === 'lock') {
      hold.locked = true;
      setVoiceHoldLocked(true);
      setVoiceHoldHint('record');
      return;
    }
    if (action === 'cancel') {
      cancelVoice();
      return;
    }
    await sendVoice();
  }, [cancelVoice, sendVoice]);

  return (
    <ChatComposer
      onLayout={onLayout}
      value={value}
      onChangeText={onChangeText}
      onSend={onSend}
      placeholder={placeholder}
      mode={mode}
      onOpenContext={onOpenContext}
      contextLabel={contextLabel}
      contextPreview={contextPreview}
      onCancelMode={onCancelMode}
      busy={busy}
      onAttachmentPress={onAttachmentPress}
      onEmojiPress={onEmojiPress}
      uploadLabel={uploadLabel}
      uploadProgress={uploadProgress}
      voiceRecording={voiceRecording}
      voiceDurationLabel={formatVoiceDuration(voiceRecordingDuration)}
      voiceLevel={voiceRecordingLevel}
      voiceHoldLocked={voiceHoldLocked}
      voiceHoldHint={voiceHoldHint}
      onMicPress={canRecord ? () => void startVoice(true) : undefined}
      onMicHoldStart={() => void startVoice(false)}
      onMicHoldMove={moveVoiceHold}
      onMicHoldRelease={() => void releaseVoiceHold()}
      onCancelVoice={cancelVoice}
      onSendVoice={() => void sendVoice()}
    />
  );
}
