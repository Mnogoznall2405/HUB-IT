// Layout helpers for the active call panel: remembered floating position,
// spotlight selection and the Fullscreen API wrappers. No React state of the
// call itself lives here; the panel decides what to show.

import { useCallback, useEffect, useRef, useState } from 'react';

export const PANEL_POSITION_STORAGE_KEY = 'hubit.chat.callPanel.position';
export const PANEL_TESTID = 'chat-call-panel';

// Spotlight choice made by the user. `auto` means "a remote screen share if
// there is one, otherwise the grid"; a new share always resets to `auto`.
export const SPOTLIGHT_AUTO = Object.freeze({ mode: 'auto' });
export const SPOTLIGHT_GRID = Object.freeze({ mode: 'grid' });

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

export function readStoredPanelPosition() {
  try {
    const raw = window.localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (Number.isFinite(value?.left) && Number.isFinite(value?.top)) {
      return { left: value.left, top: value.top };
    }
  } catch {
    // Storage is blocked or the value is broken: the default corner is used.
  }
  return null;
}

export function storePanelPosition(position) {
  try {
    window.localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Remembering the position is optional.
  }
}

// Keeps a box of `size` fully inside the viewport (top-left corner coordinates).
export function clampPanelPosition(position, size, viewport) {
  const maxLeft = Math.max(0, viewport.width - size.width);
  const maxTop = Math.max(0, viewport.height - size.height);
  return {
    left: Math.min(Math.max(0, position.left), maxLeft),
    top: Math.min(Math.max(0, position.top), maxTop),
  };
}

// The tile that is shown large. A user pin wins while that tile exists; if it
// has left, the call falls back to the screen share (or the grid).
export function resolveMainTileKey(choice, tileKeys, shareKey) {
  if (choice.mode === 'grid') return null;
  if (choice.mode === 'pinned' && tileKeys.has(choice.key)) return choice.key;
  return shareKey && tileKeys.has(shareKey) ? shareKey : null;
}

export function canUseFullscreen() {
  return typeof document !== 'undefined'
    && document.fullscreenEnabled !== false
    && typeof document.documentElement?.requestFullscreen === 'function';
}

export function canUsePictureInPicture() {
  return typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);
}

export function isPanelFullscreen(node) {
  return Boolean(node) && typeof document !== 'undefined' && document.fullscreenElement === node;
}

// Only the call panel's own fullscreen is released; other fullscreen elements
// of the page are left alone.
export function exitPanelFullscreen() {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement?.getAttribute?.('data-testid') !== PANEL_TESTID) return;
  Promise.resolve(document.exitFullscreen?.()).catch(() => {});
}

// Rejects when the API is missing or the browser refuses (no user gesture, etc.).
export function enterPanelFullscreen(node) {
  if (!node || !canUseFullscreen()) {
    return Promise.reject(new Error('fullscreen-unavailable'));
  }
  if (document.fullscreenElement === node) return Promise.resolve();
  try {
    return Promise.resolve(node.requestFullscreen());
  } catch (error) {
    return Promise.reject(error);
  }
}

// Drag state for the floating panel. The position is kept in the viewport on
// window resize and whenever the panel changes its own size.
export function useFloatingPanelDrag({ panelRef, active, enabled }) {
  const [position, setPosition] = useState(readStoredPanelPosition);
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragRef = useRef(null);

  const clampToViewport = useCallback(() => {
    const node = panelRef.current;
    const current = positionRef.current;
    if (!node || !current) return;
    const rect = node.getBoundingClientRect();
    const next = clampPanelPosition(current, rect, viewportSize());
    if (next.left !== current.left || next.top !== current.top) setPosition(next);
  }, [panelRef]);

  useEffect(() => {
    if (!active) return undefined;
    const node = panelRef.current;
    window.addEventListener('resize', clampToViewport);
    const observer = typeof ResizeObserver === 'undefined' || !node
      ? null
      : new ResizeObserver(clampToViewport);
    if (node) observer?.observe(node);
    return () => {
      window.removeEventListener('resize', clampToViewport);
      observer?.disconnect();
    };
  }, [active, clampToViewport, panelRef]);

  const onPointerDown = useCallback((event) => {
    if (!enabled || event.button !== 0) return;
    // Buttons in the header keep their own clicks.
    if (event.target.closest?.('button')) return;
    const node = panelRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation; moves still arrive while the pointer is over the header.
    }
  }, [enabled, panelRef]);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPanelPosition(
      {
        left: drag.left + event.clientX - drag.startX,
        top: drag.top + event.clientY - drag.startY,
      },
      drag,
      viewportSize(),
    ));
  }, []);

  const onPointerEnd = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (positionRef.current) storePanelPosition(positionRef.current);
  }, []);

  return {
    position,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
