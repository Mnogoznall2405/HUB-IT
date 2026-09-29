import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import PauseOutlinedIcon from '@mui/icons-material/PauseOutlined';

// Single hidden <audio> shared by a list of play buttons — avoids N elements
// (and N open connections) in speakers/voices lists.
export function useSingleAudio() {
  const audioRef = useRef(null);
  const [playingSrc, setPlayingSrc] = useState(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlayingSrc(null);
  }, []);

  const toggle = useCallback(
    (src) => {
      const el = audioRef.current;
      if (!el || !src) return;
      if (playingSrc === src && !el.paused) {
        el.pause();
        return;
      }
      if (el.getAttribute('src') !== src) {
        el.src = src;
      }
      el.play().catch(() => setPlayingSrc(null));
      setPlayingSrc(src);
    },
    [playingSrc],
  );

  useEffect(() => () => audioRef.current?.pause(), []);

  const audioEl = (
    <audio
      ref={audioRef}
      style={{ display: 'none' }}
      preload="none"
      onPause={() => setPlayingSrc(null)}
      onEnded={() => setPlayingSrc(null)}
    />
  );

  return { audioEl, playingSrc, toggle, stop };
}

export function AudioPlayButton({ src, playing, onToggle, title }) {
  return (
    <Tooltip title={title || 'Прослушать'}>
      <span>
        <IconButton
          size="small"
          color={playing ? 'primary' : 'default'}
          aria-label={playing ? 'Пауза' : 'Прослушать'}
          onClick={() => onToggle(src)}
          disabled={!src}
        >
          {playing ? <PauseOutlinedIcon fontSize="small" /> : <PlayArrowOutlinedIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
