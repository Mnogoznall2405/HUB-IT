import React, { useEffect, useRef, useState } from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  MIN_SEGMENT_SEC,
  ZOOM_LEVELS,
  formatTime,
  nextViewStart,
  peaksForView,
  speakerColor,
  timeAtX,
} from './labelingModel';

const HEIGHT = 96;
const HANDLE_PX = 10;
const CLICK_SLOP_PX = 3;

// Zoomed view around the playhead: waveform + segments; the selected segment
// gets drag handles on both edges (commit on release, one undo step per drag).
function VoiceLabelWaveform({
  peaks, segments, order, duration, currentTime, selectedId, onSeek, onSelect, onBoundaryCommit,
}) {
  const theme = useTheme();
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [windowSec, setWindowSec] = useState(30);
  const [viewStart, setViewStart] = useState(0);
  const [drag, setDrag] = useState(null); // { id, edge, t, startX, moved }
  const pressRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth || 0);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (drag) return;
    setViewStart((prev) => nextViewStart(prev, currentTime, windowSec, duration));
  }, [currentTime, windowSec, duration, drag]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const columns = Math.max(1, Math.floor(width / 2));
    const bars = peaksForView(peaks?.peaks, peaks?.step, viewStart, windowSec, columns);
    ctx.fillStyle = theme.palette.text.secondary;
    ctx.globalAlpha = 0.55;
    const mid = HEIGHT / 2;
    bars.forEach((v, i) => {
      const h = Math.max(1, (v / 100) * (HEIGHT - 8));
      ctx.fillRect(i * 2, mid - h / 2, 1.5, h);
    });
    ctx.globalAlpha = 1;
  }, [peaks, viewStart, windowSec, width, theme.palette.text.secondary]);

  const xOf = (t) => ((t - viewStart) / windowSec) * width;
  const tOf = (clientX) => {
    const rect = boxRef.current.getBoundingClientRect();
    return timeAtX(clientX - rect.left, rect.width, viewStart, windowSec);
  };

  const visible = segments.filter((s) => s.end > viewStart && s.start < viewStart + windowSec);
  const effective = (seg) => {
    if (!drag || drag.id !== seg.id) return seg;
    return drag.edge === 'start' ? { ...seg, start: drag.t } : { ...seg, end: drag.t };
  };

  const onPointerDown = (e) => {
    const handle = e.target?.dataset?.edge;
    pressRef.current = { x: e.clientX };
    if (handle && selectedId) {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ id: selectedId, edge: handle, t: tOf(e.clientX) });
    }
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    const seg = segments.find((s) => s.id === drag.id);
    if (!seg) return;
    let t = Math.min(Math.max(0, tOf(e.clientX)), duration || Infinity);
    if (drag.edge === 'start') t = Math.min(t, seg.end - MIN_SEGMENT_SEC);
    else t = Math.max(t, seg.start + MIN_SEGMENT_SEC);
    setDrag((d) => (d ? { ...d, t } : d));
  };

  const onPointerUp = (e) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (drag) {
      onBoundaryCommit(drag.id, drag.edge, drag.t);
      setDrag(null);
      return;
    }
    if (press && Math.abs(e.clientX - press.x) <= CLICK_SLOP_PX) {
      const segId = e.target?.dataset?.segId;
      if (segId) onSelect(segId);
      onSeek(tOf(e.clientX));
    }
  };

  const ticks = [];
  const tickStep = windowSec <= 10 ? 1 : windowSec <= 30 ? 5 : 15;
  for (let t = Math.ceil(viewStart / tickStep) * tickStep; t <= viewStart + windowSec; t += tickStep) {
    ticks.push(t);
  }

  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {peaks ? 'Волна' : 'Шкала'} {formatTime(viewStart)}–{formatTime(viewStart + windowSec)}.
          {' '}Выберите реплику и тяните её края.
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={windowSec}
          onChange={(_e, v) => { if (v) setWindowSec(v); }}
          aria-label="Масштаб"
        >
          {ZOOM_LEVELS.map((z) => (
            <ToggleButton key={z} value={z} sx={{ py: 0.25, px: 1 }}>
              {z < 60 ? `${z} с` : `${z / 60} мин`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      <Box
        ref={boxRef}
        data-testid="label-waveform"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        sx={{
          position: 'relative',
          height: HEIGHT,
          borderRadius: 1,
          bgcolor: 'action.hover',
          overflow: 'hidden',
          cursor: drag ? 'ew-resize' : 'pointer',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {visible.map((raw) => {
          const seg = effective(raw);
          const isSel = seg.id === selectedId;
          const left = Math.max(0, xOf(seg.start));
          const right = Math.min(width, xOf(seg.end));
          return (
            <div
              key={seg.id}
              data-seg-id={seg.id}
              style={{
                position: 'absolute',
                left,
                width: Math.max(1, right - left),
                top: isSel ? 0 : 14,
                bottom: isSel ? 0 : 14,
                background: speakerColor(seg.speaker, order),
                opacity: isSel ? 0.45 : 0.25,
                outline: isSel ? `2px solid ${theme.palette.primary.main}` : 'none',
                borderRadius: 3,
              }}
            >
              {isSel && ['start', 'end'].map((edge) => (
                <div
                  key={edge}
                  data-edge={edge}
                  role="separator"
                  aria-label={edge === 'start' ? 'Начало реплики' : 'Конец реплики'}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    [edge === 'start' ? 'left' : 'right']: -HANDLE_PX / 2,
                    width: HANDLE_PX,
                    cursor: 'ew-resize',
                    background: theme.palette.primary.main,
                    opacity: 0.9,
                    borderRadius: 2,
                  }}
                />
              ))}
            </div>
          );
        })}
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: HEIGHT, pointerEvents: 'none' }}
        />
        {ticks.map((t) => (
          <Typography
            key={t}
            variant="caption"
            sx={{ position: 'absolute', bottom: 0, transform: 'translateX(-50%)', fontSize: 10, color: 'text.secondary', pointerEvents: 'none' }}
            style={{ left: xOf(t) }}
          >
            {formatTime(t).replace(/\.\d$/, '')}
          </Typography>
        ))}
        <Box
          sx={{ position: 'absolute', top: 0, bottom: 0, width: 2, bgcolor: 'error.main', pointerEvents: 'none' }}
          style={{ left: xOf(drag ? drag.t : currentTime) }}
        />
      </Box>
    </Stack>
  );
}

export default VoiceLabelWaveform;
