import { memo, useCallback, useEffect, useRef } from 'react';
import { Box } from '@mui/material';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function MailPaneResizeHandle({
  orientation = 'vertical',
  value,
  min,
  max,
  step = 10,
  defaultValue,
  label,
  testId,
  onResize,
}) {
  const cleanupDragRef = useRef(null);
  const vertical = orientation === 'vertical';

  const commitDelta = useCallback((delta, commit = true) => {
    const nextValue = clamp(Math.round(Number(value || 0) + Number(delta || 0)), min, max);
    onResize?.(nextValue, { commit });
  }, [max, min, onResize, value]);

  const stopActiveDrag = useCallback(() => {
    cleanupDragRef.current?.();
    cleanupDragRef.current = null;
  }, []);

  useEffect(() => stopActiveDrag, [stopActiveDrag]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== undefined && Number(event.button) !== 0) return;
    event.preventDefault();
    stopActiveDrag();
    const startCoordinate = vertical ? Number(event.clientX || 0) : Number(event.clientY || 0);
    const resizeContainerSize = vertical
      ? 1
      : Math.max(1, Number(event.currentTarget?.parentElement?.getBoundingClientRect?.().height || 0));
    const pointerId = event.pointerId;
    const body = document.body;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;
    body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    body.style.userSelect = 'none';

    const getDelta = (pointerEvent) => {
      const coordinate = vertical ? Number(pointerEvent.clientX || 0) : Number(pointerEvent.clientY || 0);
      const pixelDelta = coordinate - startCoordinate;
      return vertical ? pixelDelta : (pixelDelta / resizeContainerSize) * 100;
    };
    const matchesPointer = (pointerEvent) => (
      pointerId === undefined || pointerEvent.pointerId === undefined || pointerEvent.pointerId === pointerId
    );
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
    };
    const handlePointerMove = (pointerEvent) => {
      if (!matchesPointer(pointerEvent)) return;
      pointerEvent.preventDefault();
      commitDelta(getDelta(pointerEvent), false);
    };
    const handlePointerUp = (pointerEvent) => {
      if (!matchesPointer(pointerEvent)) return;
      cleanup();
      cleanupDragRef.current = null;
      commitDelta(getDelta(pointerEvent), true);
    };
    const handlePointerCancel = (pointerEvent) => {
      if (!matchesPointer(pointerEvent)) return;
      cleanup();
      cleanupDragRef.current = null;
      onResize?.(clamp(Math.round(Number(value || 0)), min, max), { commit: false });
    };

    cleanupDragRef.current = cleanup;
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }, [commitDelta, max, min, onResize, stopActiveDrag, value, vertical]);

  const handleKeyDown = useCallback((event) => {
    let delta = 0;
    if (vertical && event.key === 'ArrowLeft') delta = -step;
    if (vertical && event.key === 'ArrowRight') delta = step;
    if (!vertical && event.key === 'ArrowUp') delta = -step;
    if (!vertical && event.key === 'ArrowDown') delta = step;
    if (event.key === 'Home') delta = min - Number(value || 0);
    if (event.key === 'End') delta = max - Number(value || 0);
    if (!delta) return;
    event.preventDefault();
    commitDelta(delta, true);
  }, [commitDelta, max, min, step, value, vertical]);

  return (
    <Box
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-testid={testId}
      title={`${label}. Потяните мышью; двойной щелчок сбрасывает размер.`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onResize?.(clamp(Number(defaultValue || value), min, max), { commit: true })}
      sx={{
        position: 'relative',
        width: vertical ? '7px' : '100%',
        height: vertical ? '100%' : '7px',
        minWidth: vertical ? '7px' : 0,
        minHeight: vertical ? 0 : '7px',
        cursor: vertical ? 'col-resize' : 'row-resize',
        touchAction: 'none',
        bgcolor: 'transparent',
        zIndex: 3,
        outline: 'none',
        '&::after': {
          content: '""',
          position: 'absolute',
          ...(vertical
            ? { top: 0, bottom: 0, left: '3px', width: '1px' }
            : { left: 0, right: 0, top: '3px', height: '1px' }),
          bgcolor: 'var(--mail-divider)',
          transition: 'background-color 120ms ease, box-shadow 120ms ease',
        },
        '&:hover::after, &:focus-visible::after': {
          bgcolor: 'primary.main',
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
        },
        '&:focus-visible': {
          bgcolor: 'action.hover',
        },
      }}
    />
  );
}

export default memo(MailPaneResizeHandle);
