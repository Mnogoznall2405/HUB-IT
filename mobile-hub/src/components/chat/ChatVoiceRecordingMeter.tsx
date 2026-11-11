import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  VOICE_RECORDING_BAR_PROFILE,
  VOICE_RECORDING_BARS,
  clampVoiceLevel,
  fallbackVoiceRecordingLevel,
  recordingBarHeightPx,
} from '../../chat/chatVoice';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function ChatVoiceRecordingMeter({
  level,
  compact = true,
}: {
  level?: number | null;
  compact?: boolean;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const resolvedLevel = level == null
    ? fallbackVoiceRecordingLevel(nowMs)
    : clampVoiceLevel(level);
  const pulse = reduceMotion ? 0 : 0.5 + 0.5 * Math.sin(tick / 7);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = setInterval(() => {
      setTick((current) => current + 1);
      if (level == null) setNowMs(Date.now());
    }, 80);
    return () => clearInterval(timer);
  }, [level, reduceMotion]);

  return (
    <View
      style={styles.wrap}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="chat-voice-recording-activity"
    >
      <View style={styles.dotWrap}>
        {!reduceMotion ? (
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                opacity: 0.1 + (1 - pulse) * (0.18 + resolvedLevel * 0.42),
                transform: [{ scale: 1 + resolvedLevel * 0.52 + pulse * 0.45 }],
              },
            ]}
          />
        ) : null}
        <View style={styles.dot} />
      </View>
      <View style={styles.waveform} testID="chat-voice-recording-waveform">
        {Array.from({ length: VOICE_RECORDING_BARS }, (_, index) => {
          const profile = VOICE_RECORDING_BAR_PROFILE[index % VOICE_RECORDING_BAR_PROFILE.length];
          return (
            <View
              key={`recording-bar-${index}`}
              testID="chat-voice-recording-bar"
              style={[
                styles.bar,
                {
                  height: recordingBarHeightPx(resolvedLevel, profile, { compact }),
                  opacity: 0.42 + resolvedLevel * 0.5,
                  backgroundColor: resolvedLevel > 0.12
                    ? chatTokens.accentText
                    : chatTokens.textSecondary,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 110,
    height: 30,
    flexShrink: 0,
  },
  dotWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: chatTokens.dangerText,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: chatTokens.dangerText,
  },
  waveform: {
    width: 84,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    overflow: 'hidden',
  },
  bar: {
    width: 2.5,
    borderRadius: 99,
  },
});
