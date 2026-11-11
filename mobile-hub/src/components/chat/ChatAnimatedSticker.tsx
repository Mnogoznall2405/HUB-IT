import { useEvent } from 'expo';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  decodeTgsStickerPayload,
  isTgsStickerSource,
  stickerAnimationCacheName,
} from '../../chat/chatStickerAnimation';
import type { StickerAnimationKind } from '../../chat/chatStickers';
import { noteLiveVideoStickers } from '../../diagnostics/uiTiming';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';

// Every video sticker owns a native ExoPlayer. A long thread full of stickers
// (or the sticker panel) can exhaust them, and `useVideoPlayer` then throws a
// CodedError while rendering — which used to take the whole screen down.
const MAX_LIVE_VIDEO_STICKERS = 4;
let liveVideoStickers = 0;

function useVideoStickerSlot(enabled: boolean): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!enabled || liveVideoStickers >= MAX_LIVE_VIDEO_STICKERS) {
      setGranted(false);
      return undefined;
    }
    liveVideoStickers += 1;
    noteLiveVideoStickers(liveVideoStickers);
    setGranted(true);
    return () => {
      liveVideoStickers -= 1;
      noteLiveVideoStickers(liveVideoStickers);
    };
  }, [enabled]);
  return granted;
}

/** A failing sticker player shows the static preview instead of failing the screen. */
class StickerPlaybackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type LoadedSticker = {
  localUri?: string;
  animation?: AnimationObject;
};

export function ChatAnimatedSticker({
  uri,
  mimeType,
  animationKind,
  size,
  accessibilityLabel,
  fallback,
}: {
  uri: string;
  mimeType?: string | null;
  animationKind?: StickerAnimationKind | null;
  size: number;
  accessibilityLabel: string;
  fallback: ReactNode;
}) {
  const tgs = animationKind === 'tgs' || isTgsStickerSource(mimeType, uri);
  const [loaded, setLoaded] = useState<LoadedSticker | null>(null);
  const [failed, setFailed] = useState(false);
  const videoSlot = useVideoStickerSlot(Boolean(loaded?.localUri) && !tgs);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoaded(null);
    setFailed(false);
    void downloadTrustedChatMedia(uri, stickerAnimationCacheName(uri, tgs), { signal: controller.signal })
      .then(async (file) => {
        if (tgs) {
          const bytes = await file.bytes();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const animation = decodeTgsStickerPayload(bytes);
          if (active) setLoaded({ animation });
        } else if (active) {
          setLoaded({ localUri: file.uri });
        }
      })
      .catch((error: unknown) => {
        if (active && (error as { name?: string })?.name !== 'AbortError') setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tgs, uri]);

  if (failed || !loaded) return <>{fallback}</>;
  if (tgs && loaded.animation) {
    return (
      <StickerPlaybackBoundary fallback={fallback}>
        <TgsSticker
          animation={loaded.animation}
          size={size}
          accessibilityLabel={accessibilityLabel}
        />
      </StickerPlaybackBoundary>
    );
  }
  if (loaded.localUri && videoSlot) {
    return (
      <StickerPlaybackBoundary fallback={fallback}>
        <VideoSticker
          uri={loaded.localUri}
          size={size}
          accessibilityLabel={accessibilityLabel}
          fallback={fallback}
        />
      </StickerPlaybackBoundary>
    );
  }
  return <>{fallback}</>;
}

function TgsSticker({
  animation,
  size,
  accessibilityLabel,
}: {
  animation: AnimationObject;
  size: number;
  accessibilityLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={accessibilityLabel}>
      <LottieView
        testID="chat-sticker-tgs"
        source={animation}
        autoPlay={!reduceMotion}
        loop={!reduceMotion}
        progress={reduceMotion ? 0 : undefined}
        style={{ width: size, height: size }}
        renderMode="HARDWARE"
      />
    </View>
  );
}

function VideoSticker({
  uri,
  size,
  accessibilityLabel,
  fallback,
}: {
  uri: string;
  size: number;
  accessibilityLabel: string;
  fallback: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [firstFrame, setFirstFrame] = useState(false);
  const player = useVideoPlayer(
    { uri, contentType: 'progressive' },
    (nextPlayer) => {
      nextPlayer.loop = true;
      nextPlayer.muted = true;
      nextPlayer.keepScreenOnWhilePlaying = false;
      if (!reduceMotion) nextPlayer.play();
    },
  );
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    // useVideoPlayer releases the native player in its own cleanup, which runs
    // before this one on unmount: pause()/play() on a released player throws, and
    // an error thrown while unmounting reaches the screen boundary (the screen
    // failed on every exit from a chat with stickers).
    const control = (action: 'play' | 'pause') => {
      try { player[action](); } catch { /* player already released */ }
    };
    control(reduceMotion ? 'pause' : 'play');
    return () => control('pause');
  }, [player, reduceMotion]);

  if (status === 'error') return <>{fallback}</>;
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={accessibilityLabel}>
      <VideoView
        testID="chat-sticker-video"
        player={player}
        style={{ width: size, height: size }}
        nativeControls={false}
        contentFit="contain"
        surfaceType="textureView"
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {!firstFrame ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>{fallback}</View> : null}
    </View>
  );
}
