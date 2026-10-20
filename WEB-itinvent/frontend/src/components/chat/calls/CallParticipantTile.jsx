import { useEffect, useRef } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import PictureInPictureAltRoundedIcon from '@mui/icons-material/PictureInPictureAltRounded';

import { getInitials } from './callsModel';

const TILE_BG = '#1d232c';

export function VideoSurface({ track, mirror = false, contain = false, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !track) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: contain ? 'contain' : 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
        background: '#000',
      }}
    />
  );
}

// A single click pins/unpins only after this delay, so a double click (pin +
// fullscreen) does not first rearrange the layout under the pointer.
const SELECT_DELAY_MS = 250;

const ACTION_SX = {
  width: 30,
  height: 30,
  color: '#fff',
  bgcolor: 'rgba(0,0,0,0.55)',
  '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
};

const SIZE_SX = {
  grid: { minHeight: 120, aspectRatio: '4 / 3' },
  main: { position: 'absolute', inset: 0, minHeight: 0 },
  strip: { width: 148, flexShrink: 0, aspectRatio: '16 / 9', minHeight: 0 },
};

// `variant`: grid (default tile), main (spotlight, fills its parent) or strip
// (thumbnail). `onSelect` makes the tile pinnable; the cover button under the
// controls is the click target, so tiles stay keyboard reachable.
export function ParticipantTile({
  name,
  videoTrack,
  mirror,
  contain,
  speaking,
  micOff,
  pendingLabel,
  muted,
  testId,
  variant = 'grid',
  selectLabel,
  onSelect,
  onDoubleClick,
  onFullscreen,
  fullscreenActive = false,
  canPictureInPicture = false,
}) {
  const tileRef = useRef(null);
  const selectTimerRef = useRef(0);
  const avatarSize = variant === 'strip' ? 40 : 64;
  const showPip = canPictureInPicture && Boolean(videoTrack);
  const hasActions = Boolean(onFullscreen) || showPip;

  useEffect(() => () => window.clearTimeout(selectTimerRef.current), []);

  const openPictureInPicture = () => {
    const video = tileRef.current?.querySelector('video');
    if (!video || typeof video.requestPictureInPicture !== 'function') return;
    video.requestPictureInPicture().catch(() => {});
  };

  return (
    <Box
      ref={tileRef}
      data-testid={testId}
      data-speaking={speaking ? 'true' : 'false'}
      data-variant={variant}
      sx={{
        position: 'relative',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: TILE_BG,
        outline: speaking ? '3px solid #43a047' : '3px solid transparent',
        outlineOffset: '-3px',
        transition: 'outline-color 120ms ease',
        '&:hover .chat-call-tile-actions, &:focus-within .chat-call-tile-actions': { opacity: 1 },
        ...SIZE_SX[variant],
      }}
    >
      {videoTrack ? (
        <VideoSurface track={videoTrack} mirror={mirror} contain={contain} muted={muted} />
      ) : (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
          <Avatar sx={{ width: avatarSize, height: avatarSize, fontSize: avatarSize / 3, bgcolor: 'primary.main' }}>
            {getInitials(name)}
          </Avatar>
        </Stack>
      )}
      {onSelect ? (
        <ButtonBase
          aria-label={selectLabel}
          onClick={(event) => {
            // The second click of a double click is handled by onDoubleClick.
            if (event.detail > 1) return;
            window.clearTimeout(selectTimerRef.current);
            selectTimerRef.current = window.setTimeout(onSelect, SELECT_DELAY_MS);
          }}
          onDoubleClick={() => {
            window.clearTimeout(selectTimerRef.current);
            onDoubleClick?.();
          }}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            borderRadius: 2,
            '&.Mui-focusVisible': { outline: '2px solid #90caf9', outlineOffset: -2 },
          }}
        />
      ) : null}
      {hasActions ? (
        <Stack
          direction="row"
          spacing={0.5}
          className="chat-call-tile-actions"
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 2,
            opacity: 0,
            transition: 'opacity 120ms ease',
            // Touch screens have no hover: the actions stay visible there.
            '@media (hover: none)': { opacity: 1 },
          }}
        >
          {showPip ? (
            <IconButton
              size="small"
              aria-label="Картинка в картинке"
              data-testid="chat-call-tile-pip"
              onClick={openPictureInPicture}
              sx={ACTION_SX}
            >
              <PictureInPictureAltRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {onFullscreen ? (
            <IconButton
              size="small"
              aria-label={fullscreenActive ? 'Выйти из полноэкранного режима' : 'На весь экран'}
              data-testid="chat-call-tile-fullscreen"
              onClick={onFullscreen}
              sx={ACTION_SX}
            >
              {fullscreenActive ? <FullscreenExitRoundedIcon fontSize="small" /> : <FullscreenRoundedIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </Stack>
      ) : null}
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          maxWidth: 'calc(100% - 16px)',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          bgcolor: 'rgba(0,0,0,0.55)',
          color: '#fff',
          pointerEvents: 'none',
        }}
      >
        {micOff ? <MicOffRoundedIcon sx={{ fontSize: 14 }} /> : null}
        <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, color: 'inherit' }}>
          {pendingLabel ? `${name} · ${pendingLabel}` : name}
        </Typography>
      </Stack>
    </Box>
  );
}

// The local camera shown over the spotlighted tile, so it is not in the strip too.
export function SelfPip({ track }) {
  return (
    <Box
      data-testid="chat-call-self-pip"
      role="img"
      aria-label="Ваше видео"
      sx={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        width: { xs: 120, sm: 160 },
        aspectRatio: '4 / 3',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: TILE_BG,
        border: '2px solid rgba(255,255,255,0.35)',
        boxShadow: 4,
        zIndex: 3,
        pointerEvents: 'none',
      }}
    >
      <VideoSurface track={track} mirror muted />
    </Box>
  );
}
