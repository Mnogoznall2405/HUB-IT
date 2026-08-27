import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  VOICE_PLAYBACK_BARS,
  isVoiceWaveformBarFilled,
  lockChatVoiceSurface,
  unlockChatVoiceSurface,
  voiceSeekRatio,
} from '../../chat/chatVoice';

export function ChatVoiceWaveform({
  bars,
  progress,
  filledColor,
  emptyColor,
  currentTime = 0,
  duration = 0,
  onSeek,
}: {
  bars: number[];
  progress: number;
  filledColor: string;
  emptyColor: string;
  currentTime?: number;
  duration?: number;
  onSeek?: (ratio: number) => void;
}) {
  const widthRef = useRef(1);
  const heldRef = useRef(false);
  const resolvedBars = bars.length ? bars : Array.from({ length: VOICE_PLAYBACK_BARS }, () => 0.4);

  useEffect(() => () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    unlockChatVoiceSurface();
  }, []);

  return (
    <Pressable
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width || 1;
      }}
      onPressIn={() => {
        if (heldRef.current) return;
        heldRef.current = true;
        lockChatVoiceSurface();
      }}
      onPressOut={() => {
        if (!heldRef.current) return;
        heldRef.current = false;
        unlockChatVoiceSurface();
      }}
      onPress={(event) => {
        event.stopPropagation();
        onSeek?.(voiceSeekRatio(event.nativeEvent.locationX, widthRef.current));
      }}
      accessibilityRole="adjustable"
      accessibilityLabel="Прогресс воспроизведения"
      accessibilityValue={{
        min: 0,
        max: Math.max(0, Math.round(duration)),
        now: Math.max(0, Math.round(currentTime)),
      }}
      style={styles.track}
    >
      {resolvedBars.map((height, index) => {
        const filled = isVoiceWaveformBarFilled(progress, index, resolvedBars.length);
        return (
          <View
            key={`voice-bar-${index}`}
            testID={filled ? 'chat-voice-bar-filled' : 'chat-voice-bar'}
            style={[
              styles.bar,
              {
                height: `${Math.round(Math.max(0.18, height) * 100)}%`,
                backgroundColor: filled ? filledColor : emptyColor,
              },
            ]}
          />
        );
      })}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    flex: 1,
    minHeight: 2,
    borderRadius: 1,
  },
});
