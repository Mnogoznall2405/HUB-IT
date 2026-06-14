import { useCallback, useEffect, useRef, useState } from 'react';

export const clampDocumentZoom = (value, minZoom = 1, maxZoom = 3) => {
  const normalized = Number(value || 1);
  if (!Number.isFinite(normalized)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, normalized));
};

const distanceBetweenTouches = (touchA, touchB) => {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
};

const midpointBetweenTouches = (touchA, touchB) => ({
  x: (touchA.clientX + touchB.clientX) / 2,
  y: (touchA.clientY + touchB.clientY) / 2,
});

export default function useDocumentPinchPan({
  enabled = true,
  minZoom = 1,
  maxZoom = 3,
  zoomStep = 0.15,
} = {}) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const gestureRef = useRef({
    mode: 'idle',
    startScale: 1,
    startDistance: 0,
    startTranslateX: 0,
    startTranslateY: 0,
    startMidpoint: { x: 0, y: 0 },
    lastPanPoint: { x: 0, y: 0 },
    lastTapAt: 0,
  });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setTransform((current) => ({
      ...current,
      scale: clampDocumentZoom(current.scale + zoomStep, minZoom, maxZoom),
    }));
  }, [maxZoom, minZoom, zoomStep]);

  const zoomOut = useCallback(() => {
    setTransform((current) => {
      const nextScale = clampDocumentZoom(current.scale - zoomStep, minZoom, maxZoom);
      if (nextScale <= minZoom + 0.001) {
        return { scale: 1, x: 0, y: 0 };
      }
      return { ...current, scale: nextScale };
    });
  }, [maxZoom, minZoom, zoomStep]);

  const isZoomed = transform.scale > 1.001;

  useEffect(() => {
    if (!enabled) return undefined;

    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -zoomStep : zoomStep;
      setTransform((current) => {
        const nextScale = clampDocumentZoom(current.scale + delta, minZoom, maxZoom);
        if (nextScale <= minZoom + 0.001) {
          return { scale: 1, x: 0, y: 0 };
        }
        return { ...current, scale: nextScale };
      });
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [enabled, maxZoom, minZoom, zoomStep]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || transform.scale <= minZoom + 0.001) return undefined;

    const gesture = gestureRef.current;
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      gesture.mode = 'pan';
      gesture.lastPanPoint = { x: event.clientX, y: event.clientY };
    };
    const onMouseMove = (event) => {
      if (gesture.mode !== 'pan') return;
      const dx = event.clientX - gesture.lastPanPoint.x;
      const dy = event.clientY - gesture.lastPanPoint.y;
      gesture.lastPanPoint = { x: event.clientX, y: event.clientY };
      setTransform((current) => ({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      }));
    };
    const onMouseUp = () => {
      gesture.mode = 'idle';
    };

    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minZoom, transform.scale]);

  const handleTouchStart = useCallback((event) => {
    if (!enabled) return;
    const touches = event.touches;
    const gesture = gestureRef.current;

    if (touches.length === 2) {
      gesture.mode = 'pinch';
      gesture.startScale = transform.scale;
      gesture.startDistance = distanceBetweenTouches(touches[0], touches[1]);
      gesture.startMidpoint = midpointBetweenTouches(touches[0], touches[1]);
      gesture.startTranslateX = transform.x;
      gesture.startTranslateY = transform.y;
      return;
    }

    if (touches.length === 1 && isZoomed) {
      gesture.mode = 'pan';
      gesture.lastPanPoint = { x: touches[0].clientX, y: touches[0].clientY };
      return;
    }

    if (touches.length === 1 && !isZoomed) {
      const now = Date.now();
      if (now - gesture.lastTapAt < 300) {
        event.preventDefault();
        resetTransform();
      }
      gesture.lastTapAt = now;
    }
  }, [enabled, isZoomed, resetTransform, transform.scale, transform.x, transform.y]);

  const handleTouchMove = useCallback((event) => {
    if (!enabled) return;
    const touches = event.touches;
    const gesture = gestureRef.current;

    if (gesture.mode === 'pinch' && touches.length === 2) {
      event.preventDefault();
      const nextDistance = distanceBetweenTouches(touches[0], touches[1]);
      if (!gesture.startDistance) return;
      const scaleFactor = nextDistance / gesture.startDistance;
      const nextScale = clampDocumentZoom(gesture.startScale * scaleFactor, minZoom, maxZoom);
      const midpoint = midpointBetweenTouches(touches[0], touches[1]);
      const viewport = viewportRef.current;
      const viewportRect = viewport?.getBoundingClientRect?.();
      const originX = viewportRect ? midpoint.x - viewportRect.left + (viewport?.scrollLeft || 0) : midpoint.x;
      const originY = viewportRect ? midpoint.y - viewportRect.top + (viewport?.scrollTop || 0) : midpoint.y;
      const scaleRatio = nextScale / gesture.startScale;
      setTransform({
        scale: nextScale,
        x: originX - (originX - gesture.startTranslateX) * scaleRatio,
        y: originY - (originY - gesture.startTranslateY) * scaleRatio,
      });
      return;
    }

    if (gesture.mode === 'pan' && touches.length === 1 && isZoomed) {
      event.preventDefault();
      const touch = touches[0];
      const dx = touch.clientX - gesture.lastPanPoint.x;
      const dy = touch.clientY - gesture.lastPanPoint.y;
      gesture.lastPanPoint = { x: touch.clientX, y: touch.clientY };
      setTransform((current) => ({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      }));
    }
  }, [enabled, isZoomed, maxZoom, minZoom]);

  const handleTouchEnd = useCallback(() => {
    gestureRef.current.mode = 'idle';
    setTransform((current) => {
      if (current.scale <= minZoom + 0.001) {
        return { scale: 1, x: 0, y: 0 };
      }
      return current;
    });
  }, [minZoom]);

  return {
    viewportRef,
    contentRef,
    transform,
    isZoomed,
    resetTransform,
    zoomIn,
    zoomOut,
    viewportProps: enabled ? {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    } : {},
    viewportSx: {
      overflow: isZoomed ? 'hidden' : 'auto',
      touchAction: isZoomed ? 'none' : 'pan-y pinch-zoom',
      WebkitOverflowScrolling: 'touch',
    },
    contentSx: {
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
      transformOrigin: '0 0',
      willChange: isZoomed ? 'transform' : 'auto',
    },
  };
}
