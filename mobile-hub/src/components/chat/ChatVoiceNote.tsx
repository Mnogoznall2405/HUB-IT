import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { ChatAttachment } from '../../api/types';
import {
  buildVoiceWaveform,
  formatVoiceDuration,
  isAudioChatAttachment,
  voicePlaybackProgress,
} from '../../chat/chatVoice';
import { downloadChatAttachment } from '../../files/nativeAttachmentDownloads';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatVoiceWaveform } from './ChatVoiceWaveform';

type ActiveVoice = {
  id: string;
  stop: () => void;
};

let activeVoice: ActiveVoice | null = null;

function releaseOtherVoice(exceptId: string) {
  if (activeVoice && activeVoice.id !== exceptId) {
    activeVoice.stop();
  }
}

export function ChatVoiceNote({
  attachment,
  isOwn,
}: {
  attachment: ChatAttachment;
  isOwn: boolean;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const playerRef = useRef<AudioPlayer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const duration = Number(attachment.duration_seconds || playerRef.current?.duration || 0);
  const effectiveDuration = duration > 0 ? duration : 0;
  const progress = voicePlaybackProgress(elapsed, effectiveDuration);
  const label = formatVoiceDuration(playing || elapsed > 0 ? elapsed : duration);
  const waveform = useMemo(
    () => buildVoiceWaveform(String(attachment.id || attachment.file_name || 'voice')),
    [attachment.file_name, attachment.id],
  );

  useEffect(() => () => {
    if (activeVoice?.id === attachment.id) activeVoice = null;
    playerRef.current?.pause();
    playerRef.current?.remove();
    playerRef.current = null;
  }, [attachment.id]);

  const stopPlayback = () => {
    playerRef.current?.pause();
    void playerRef.current?.seekTo(0);
    setPlaying(false);
    setElapsed(0);
    pendingSeekRef.current = null;
    if (activeVoice?.id === attachment.id) activeVoice = null;
  };

  const pausePlayback = () => {
    playerRef.current?.pause();
    setPlaying(false);
    if (activeVoice?.id === attachment.id) activeVoice = null;
  };

  const seekToRatio = async (ratio: number) => {
    const total = effectiveDuration || Number(playerRef.current?.duration || 0);
    if (total <= 0) return;
    const next = ratio * total;
    setElapsed(next);
    if (playerRef.current) {
      await playerRef.current.seekTo(next);
      return;
    }
    pendingSeekRef.current = next;
  };

  const togglePlayback = async () => {
    if (busy) return;
    if (playing) {
      pausePlayback();
      return;
    }
    releaseOtherVoice(attachment.id);
    setBusy(true);
    try {
      if (!playerRef.current) {
        const file = await downloadChatAttachment(attachment);
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        const player = createAudioPlayer({ uri: file.uri });
        player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          setElapsed(Math.max(0, Number(status.currentTime || 0)));
          if (status.didJustFinish) stopPlayback();
        });
        playerRef.current = player;
        if (pendingSeekRef.current != null) {
          await player.seekTo(pendingSeekRef.current);
          pendingSeekRef.current = null;
        }
      }
      activeVoice = { id: attachment.id, stop: stopPlayback };
      playerRef.current.play();
      setPlaying(true);
    } catch {
      stopPlayback();
    } finally {
      setBusy(false);
    }
  };

  if (!isAudioChatAttachment(attachment)) return null;

  const filledColor = isOwn ? chatTokens.bubbleOwnText : chatTokens.composerActionBg;
  const emptyColor = isOwn ? 'rgba(17,27,33,0.22)' : 'rgba(15,121,189,0.18)';

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          void togglePlayback();
        }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: filledColor },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={playing
          ? `Пауза голосового сообщения ${label}`
          : `Воспроизвести голосовое сообщение ${label}`}
      >
        {busy ? (
          <ActivityIndicator color={isOwn ? chatTokens.bubbleOwnBg : '#fff'} />
        ) : (
          <Text style={[styles.icon, { color: isOwn ? chatTokens.bubbleOwnBg : '#fff' }]}>
            {playing ? '❚❚' : '▶'}
          </Text>
        )}
      </Pressable>
      <View style={styles.meta}>
        <ChatVoiceWaveform
          bars={waveform}
          progress={progress}
          filledColor={filledColor}
          emptyColor={emptyColor}
          currentTime={elapsed}
          duration={effectiveDuration}
          onSeek={(ratio) => void seekToRatio(ratio)}
        />
        <Text style={[styles.duration, isOwn ? styles.durationOwn : styles.durationOther]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.88 },
  icon: { fontSize: 16, fontWeight: '800' },
  meta: { flex: 1, minWidth: 0 },
  duration: { marginTop: 3, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  durationOwn: { color: chatTokens.bubbleOwnMetaText },
  durationOther: { color: chatTokens.bubbleOtherMetaText },
});
