import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import FitScreenIcon from '@mui/icons-material/FitScreen';

export const MIN_SCALE = 1;
export const MAX_SCALE = 16;
const BUTTON_FACTOR = 1.6;
const DOUBLE_CLICK_SCALE = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const IDENTITY = { scale: 1, x: 0, y: 0 };

// Pan is limited so the zoomed picture can't be dragged away from the frame.
function clampView(view, width, height) {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  if (scale <= MIN_SCALE) return IDENTITY;
  const maxX = (width * (scale - 1)) / 2 + width * 0.1;
  const maxY = (height * (scale - 1)) / 2 + height * 0.1;
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

// Zoom keeping the point under (px, py) — offsets from the frame centre — fixed.
function zoomAt(view, nextScale, px, py, width, height) {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView({
    scale,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  }, width, height);
}

// Photo viewer like an image editor: wheel / pinch / +- to zoom up to 16x,
// drag to pan, double click to jump in and back out.
export default function ZoomableImage({ src, alt = '', resetKey = '' }) {
  const frameRef = useRef(null);
  const viewRef = useRef(IDENTITY);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const [view, setViewState] = useState(IDENTITY);
  const [dragging, setDragging] = useState(false);

  const setView = useCallback((next) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const frameSize = () => {
    const rect = frameRef.current?.getBoundingClientRect?.();
    return { rect, width: rect?.width || 0, height: rect?.height || 0 };
  };

  const zoomBy = useCallback((factor, clientX = null, clientY = null) => {
    const { rect, width, height } = frameSize();
    const px = clientX === null || !rect ? 0 : clientX - rect.left - width / 2;
    const py = clientY === null || !rect ? 0 : clientY - rect.top - height / 2;
    const current = viewRef.current;
    setView(zoomAt(current, current.scale * factor, px, py, width, height));
  }, [setView]);

  const reset = useCallback(() => setView(IDENTITY), [setView]);

  useEffect(() => { reset(); }, [src, resetKey, reset]);

  // React registers wheel listeners as passive, so preventDefault needs a native one.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0016), event.clientX, event.clientY);
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') zoomBy(BUTTON_FACTOR);
      else if (event.key === '-' || event.key === '_') zoomBy(1 / BUTTON_FACTOR);
      else if (event.key === '0') reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomBy, reset]);

  const startGesture = () => {
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      gestureRef.current = {
        type: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: viewRef.current.scale,
      };
    } else if (points.length === 1) {
      gestureRef.current = {
        type: 'pan',
        startX: points[0].x,
        startY: points[0].y,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
      };
    } else {
      gestureRef.current = null;
    }
  };

  const onPointerDown = (event) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    startGesture();
  };

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;
    const { rect, width, height } = frameSize();
    if (gesture.type === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2 - (rect?.left || 0) - width / 2;
      const midY = (a.y + b.y) / 2 - (rect?.top || 0) - height / 2;
      const current = viewRef.current;
      setView(zoomAt(current, gesture.scale * (distance / gesture.distance), midX, midY, width, height));
    } else if (gesture.type === 'pan' && viewRef.current.scale > MIN_SCALE) {
      setView(clampView({
        scale: viewRef.current.scale,
        x: gesture.originX + (event.clientX - gesture.startX),
        y: gesture.originY + (event.clientY - gesture.startY),
      }, width, height));
    }
  };

  const onPointerEnd = (event) => {
    pointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointersRef.current.size === 0) setDragging(false);
    startGesture();
  };

  const onDoubleClick = (event) => {
    if (viewRef.current.scale > MIN_SCALE) reset();
    else zoomBy(DOUBLE_CLICK_SCALE, event.clientX, event.clientY);
  };

  const zoomed = view.scale > MIN_SCALE;
  const percent = `${Math.round(view.scale * 100)}%`;

  return (
    <Box
      ref={frameRef}
      data-testid="zoomable-image"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        cursor: dragging && zoomed ? 'grabbing' : (zoomed ? 'grab' : 'zoom-in'),
      }}
    >
      <Box
        component="img"
        src={src}
        alt={alt}
        draggable={false}
        // Inline style: the transform changes every pointer move, a generated class per frame is wasteful.
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          // Sharp pixels once zoomed in — that is the point of zooming.
          imageRendering: view.scale >= 4 ? 'pixelated' : 'auto',
        }}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          transformOrigin: 'center center',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      />
      <Box
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        sx={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          borderRadius: 1.5,
          bgcolor: 'rgba(0,0,0,0.55)',
          color: '#fff',
        }}
      >
        <Tooltip title="Уменьшить (−)">
          <span>
            <IconButton
              aria-label="Уменьшить"
              size="small"
              disabled={!zoomed}
              onClick={() => zoomBy(1 / BUTTON_FACTOR)}
              sx={{ color: 'inherit' }}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" sx={{ minWidth: 44, textAlign: 'center' }} aria-live="polite">
          {percent}
        </Typography>
        <Tooltip title="Увеличить (+)">
          <span>
            <IconButton
              aria-label="Увеличить"
              size="small"
              disabled={view.scale >= MAX_SCALE}
              onClick={() => zoomBy(BUTTON_FACTOR)}
              sx={{ color: 'inherit' }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Вписать в экран (0)">
          <span>
            <IconButton
              aria-label="Вписать в экран"
              size="small"
              disabled={!zoomed}
              onClick={reset}
              sx={{ color: 'inherit' }}
            >
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
