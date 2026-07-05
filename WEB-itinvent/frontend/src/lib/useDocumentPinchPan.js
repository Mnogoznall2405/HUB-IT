import { useCallback, useEffect, useRef, useState } from 'react';

export const clampDocumentZoom = (value, minZoom = 1, maxZoom = 3) => {
  const normalized = Number(value || 1);
  if (!Number.isFinite(normalized)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, normalized));
};

export const buildDocumentContentSx = (transform, isZoomed) => {
  if (!isZoomed) {
    return {};
  }
  return {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
    transformOrigin: '0 0',
    willChange: 'transform',
  };
};

export const buildDocumentViewportSx = (isZoomed) => ({
  overflowY: isZoomed ? 'hidden' : 'auto',
  overflowX: 'hidden',
  touchAction: isZoomed ? 'none' : 'pan-y pinch-zoom',
  WebkitOverflowScrolling: 'touch',
});

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
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const gestureRef = useRef({
    mode: 'idle',
    startScale: 1,
    startDistance: 0,
    startTranslateX: 0,
    startTranslateY: 0,
    lastPanPoint: { x: 0, y: 0 },
    lastTapAt: 0,
  });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const applyTransform = useCallback((nextTransform) => {
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }, []);

  const resetTransform = useCallback(() => {
    applyTransform({ scale: 1, x: 0, y: 0 });
  }, [applyTransform]);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const isZoomed = transform.scale > 1.001;

  useEffect(() => {
    if (!enabled) return undefined;

    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -zoomStep : zoomStep;
      const current = transformRef.current;
      const nextScale = clampDocumentZoom(current.scale + delta, minZoom, maxZoom);
      if (nextScale <= minZoom + 0.001) {
        applyTransform({ scale: 1, x: 0, y: 0 });
        return;
      }
      applyTransform({ ...current, scale: nextScale });
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [applyTransform, enabled, maxZoom, minZoom, zoomStep]);

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
      const current = transformRef.current;
      applyTransform({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      });
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
  }, [applyTransform, minZoom, transform.scale]);

  useEffect(() => {
    if (!enabled) return undefined;

    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const gesture = gestureRef.current;

    const onTouchStart = (event) => {
      const touches = event.touches;
      const current = transformRef.current;
      const zoomed = current.scale > minZoom + 0.001;

      if (touches.length === 2) {
        gesture.mode = 'pinch';
        gesture.startScale = current.scale;
        gesture.startDistance = distanceBetweenTouches(touches[0], touches[1]);
        gesture.startTranslateX = current.x;
        gesture.startTranslateY = current.y;
        return;
      }

      if (touches.length === 1 && zoomed) {
        gesture.mode = 'pan';
        gesture.lastPanPoint = { x: touches[0].clientX, y: touches[0].clientY };
        return;
      }

      if (touches.length === 1 && !zoomed) {
        const now = Date.now();
        if (now - gesture.lastTapAt < 300) {
          resetTransform();
        }
        gesture.lastTapAt = now;
        gesture.mode = 'idle';
      }
    };

    const onTouchMove = (event) => {
      const touches = event.touches;
      const current = transformRef.current;
      const zoomed = current.scale > minZoom + 0.001;

      if (gesture.mode === 'pinch' && touches.length === 2) {
        event.preventDefault();
        const nextDistance = distanceBetweenTouches(touches[0], touches[1]);
        if (!gesture.startDistance) return;
        const scaleFactor = nextDistance / gesture.startDistance;
        const nextScale = clampDocumentZoom(gesture.startScale * scaleFactor, minZoom, maxZoom);
        const midpoint = midpointBetweenTouches(touches[0], touches[1]);
        const viewportRect = viewport.getBoundingClientRect();
        const originX = midpoint.x - viewportRect.left + viewport.scrollLeft;
        const originY = midpoint.y - viewportRect.top + viewport.scrollTop;
        const scaleRatio = nextScale / gesture.startScale;
        applyTransform({
          scale: nextScale,
          x: originX - (originX - gesture.startTranslateX) * scaleRatio,
          y: originY - (originY - gesture.startTranslateY) * scaleRatio,
        });
        return;
      }

      if (gesture.mode === 'pan' && touches.length === 1 && zoomed) {
        event.preventDefault();
        const touch = touches[0];
        const dx = touch.clientX - gesture.lastPanPoint.x;
        const dy = touch.clientY - gesture.lastPanPoint.y;
        gesture.lastPanPoint = { x: touch.clientX, y: touch.clientY };
        applyTransform({
          ...current,
          x: current.x + dx,
          y: current.y + dy,
        });
      }
    };

    const onTouchEnd = () => {
      gesture.mode = 'idle';
      const current = transformRef.current;
      if (current.scale <= minZoom + 0.001) {
        applyTransform({ scale: 1, x: 0, y: 0 });
      }
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [applyTransform, enabled, minZoom, maxZoom, resetTransform]);

  return {
    viewportRef,
    contentRef,
    transform,
    isZoomed,
    resetTransform,
    viewportSx: buildDocumentViewportSx(isZoomed),
    contentSx: buildDocumentContentSx(transform, isZoomed),
  };
}
