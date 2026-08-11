import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, useMediaQuery } from '@mui/material';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import useChatStickerMediaActivity from './useChatStickerMediaActivity';

const TGS_MIME_TYPE = 'application/x-tgsticker';
let fflateModulePromise = null;
let lottieModulePromise = null;

const loadFflateModule = () => {
  if (!fflateModulePromise) fflateModulePromise = import('fflate');
  return fflateModulePromise;
};

const loadLottieModule = () => {
  if (!lottieModulePromise) lottieModulePromise = import('lottie-web/build/player/lottie_light');
  return lottieModulePromise;
};

const isTgsSticker = (mimeType, src) => (
  String(mimeType || '').trim().toLowerCase() === TGS_MIME_TYPE
  || String(src || '').split('?')[0].toLowerCase().endsWith('.tgs')
);

const isVideoSticker = (mimeType, src) => (
  String(mimeType || '').trim().toLowerCase().startsWith('video/')
  || String(src || '').split('?')[0].toLowerCase().endsWith('.webm')
);

async function decodeTgsPayload(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { gunzipSync, strFromU8 } = await loadFflateModule();
  const jsonBytes = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return JSON.parse(strFromU8(jsonBytes));
}

const ChatStickerMedia = memo(function ChatStickerMedia({
  src,
  mimeType,
  emoji = '',
  alt = '',
  decorative = false,
  autoPlay = false,
  forceAutoPlay = false,
  showPlaybackControl = false,
  posterSrc = '',
  eager = false,
  size = 184,
}) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const lottieContainerRef = useRef(null);
  const lottieAnimationRef = useRef(null);
  const playingRef = useRef(false);
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [playOverride, setPlayOverride] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tgsReady, setTgsReady] = useState(false);
  const tgs = isTgsSticker(mimeType, src);
  const video = isVideoSticker(mimeType, src);
  const animated = tgs || video;
  const { shouldMountMedia, shouldPlayMedia } = useChatStickerMediaActivity({
    rootRef,
    enabled: animated,
    eager,
  });
  const defaultPlaying = Boolean(autoPlay && (forceAutoPlay || !prefersReducedMotion));
  const requestedPlaying = playOverride === null ? defaultPlaying : Boolean(playOverride);
  const playing = Boolean(requestedPlaying && shouldPlayMedia);
  playingRef.current = playing;
  const accessibleLabel = String(alt || `Стикер ${emoji}` || 'Стикер').trim();
  const numericSize = Math.max(40, Number(size || 184));

  useEffect(() => {
    setPlayOverride(null);
    setLoadFailed(false);
    setTgsReady(false);
  }, [src]);

  useEffect(() => {
    if (!video || !shouldMountMedia || !videoRef.current) return;
    if (playing) {
      const promise = videoRef.current.play?.();
      promise?.catch?.(() => {});
    } else {
      videoRef.current.pause?.();
    }
  }, [playing, shouldMountMedia, video]);

  useEffect(() => {
    if (!video || !shouldMountMedia || !videoRef.current) return undefined;
    const media = videoRef.current;
    return () => {
      media.pause?.();
      media.removeAttribute('src');
      media.load?.();
    };
  }, [shouldMountMedia, src, video]);

  useEffect(() => {
    if (!tgs || !src || !shouldMountMedia || !lottieContainerRef.current) return undefined;
    let cancelled = false;
    let animation = null;
    const abortController = new AbortController();
    setLoadFailed(false);
    setTgsReady(false);

    const load = async () => {
      try {
        const response = await fetch(src, {
          credentials: 'same-origin',
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(`Sticker HTTP ${response.status}`);
        const [animationData, lottieModule] = await Promise.all([
          decodeTgsPayload(response),
          loadLottieModule(),
        ]);
        if (cancelled || !lottieContainerRef.current) return;
        const lottie = lottieModule.default || lottieModule;
        animation = lottie.loadAnimation({
          container: lottieContainerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        lottieAnimationRef.current = animation;
        setTgsReady(true);
        animation.goToAndStop(0, true);
        if (playingRef.current) animation.play();
      } catch (error) {
        if (!cancelled && error?.name !== 'AbortError') setLoadFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
      abortController.abort();
      lottieAnimationRef.current = null;
      animation?.destroy?.();
    };
  }, [shouldMountMedia, src, tgs]);

  useEffect(() => {
    const animation = lottieAnimationRef.current;
    if (!animation) return;
    if (playing) animation.play();
    else animation.pause();
  }, [playing]);

  const rootStyle = useMemo(() => ({
    position: 'relative',
    width: numericSize,
    maxWidth: '100%',
    aspectRatio: '1 / 1',
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    contain: 'layout paint',
  }), [numericSize]);

  const placeholder = posterSrc ? (
    <Box
      component="img"
      src={posterSrc}
      alt={decorative ? '' : accessibleLabel}
      aria-hidden={decorative || undefined}
      loading="lazy"
      decoding="async"
      data-testid="chat-sticker-poster"
      sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  ) : (
    <Box
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : accessibleLabel}
      aria-hidden={decorative || undefined}
      sx={{ fontSize: Math.max(30, numericSize * 0.38), lineHeight: 1 }}
    >
      {emoji || '🙂'}
    </Box>
  );

  return (
    <Box ref={rootRef} sx={rootStyle} data-testid="chat-sticker-media">
      {loadFailed ? (
        <Box
          role={decorative ? undefined : 'img'}
          aria-label={decorative ? undefined : accessibleLabel}
          aria-hidden={decorative || undefined}
          sx={{ fontSize: Math.max(30, numericSize * 0.38), lineHeight: 1 }}
        >
          {emoji || '🙂'}
        </Box>
      ) : animated && !shouldMountMedia ? placeholder : tgs ? (
        <>
          <Box
            ref={lottieContainerRef}
            role={!decorative && tgsReady ? 'img' : undefined}
            aria-label={!decorative && tgsReady ? accessibleLabel : undefined}
            aria-hidden={decorative || undefined}
            sx={{ width: '100%', height: '100%', '& svg': { display: 'block' } }}
          />
          {!tgsReady ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              {placeholder}
            </Box>
          ) : null}
        </>
      ) : video ? (
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc || undefined}
          aria-label={decorative ? undefined : accessibleLabel}
          aria-hidden={decorative || undefined}
          preload="auto"
          muted
          loop
          playsInline
          autoPlay={playing}
          onError={() => setLoadFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <img
          src={src}
          alt={decorative ? '' : accessibleLabel}
          loading="lazy"
          decoding="async"
          onError={() => setLoadFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}

      {showPlaybackControl && animated && shouldMountMedia && !loadFailed ? (
        <IconButton
          type="button"
          size="small"
          aria-label={playing ? 'Приостановить анимацию стикера' : 'Воспроизвести анимацию стикера'}
          onClick={(event) => {
            event.stopPropagation();
            setPlayOverride(!playing);
          }}
          sx={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 34,
            height: 34,
            color: '#fff',
            bgcolor: 'rgba(2, 6, 23, 0.58)',
            boxShadow: '0 4px 14px rgba(2, 6, 23, 0.22)',
            transition: 'background-color 120ms ease, transform 100ms ease',
            '&:hover': { bgcolor: 'rgba(2, 6, 23, 0.72)' },
            '&:active': { transform: 'scale(0.96)' },
            '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
          }}
        >
          {playing ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}
        </IconButton>
      ) : null}
    </Box>
  );
});

export default ChatStickerMedia;
