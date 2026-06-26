import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveFolderSwipeTarget } from './chatFolderUtils';

const FOLDER_SWIPE_START_PX = 14;
const FOLDER_SWIPE_TRIGGER_PX = 80;
const FOLDER_SWIPE_MAX_OFFSET_PX = 112;
const FOLDER_SWIPE_CLICK_SUPPRESS_MS = 450;

const BLOCKED_TOUCH_SELECTOR = 'input, textarea, select, video';

const resetSwipeState = () => ({
  tracking: false,
  engaged: false,
  startX: 0,
  startY: 0,
});

export function useChatFolderSwipe({
  enabled = false,
  activeFolderKey = 'all',
  customFolders = [],
  onFolderChange,
}) {
  const [scrollElement, setScrollElementState] = useState(null);
  const swipeRef = useRef(resetSwipeState());
  const offsetRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const activeFolderKeyRef = useRef(activeFolderKey);
  const customFoldersRef = useRef(customFolders);
  const onFolderChangeRef = useRef(onFolderChange);
  const [folderSwipeOffset, setFolderSwipeOffset] = useState(0);
  const [folderSwipeDirection, setFolderSwipeDirection] = useState(0);

  activeFolderKeyRef.current = activeFolderKey;
  customFoldersRef.current = customFolders;
  onFolderChangeRef.current = onFolderChange;

  const resetGesture = useCallback(() => {
    swipeRef.current = resetSwipeState();
    offsetRef.current = 0;
    setFolderSwipeOffset(0);
  }, []);

  const shouldSuppressListClick = useCallback(() => (
    Date.now() < suppressClickUntilRef.current
  ), []);

  const setScrollElement = useCallback((node) => {
    setScrollElementState(node);
  }, []);

  useEffect(() => {
    const node = scrollElement;
    if (!enabled || !node) return undefined;

    const isBlockedTarget = (target) => Boolean(
      target?.closest?.(BLOCKED_TOUCH_SELECTOR),
    );

    const handleTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (!touch || isBlockedTarget(event.target)) return;

      swipeRef.current = {
        tracking: true,
        engaged: false,
        startX: Number(touch.clientX || 0),
        startY: Number(touch.clientY || 0),
      };
      offsetRef.current = 0;
      setFolderSwipeOffset(0);
      setFolderSwipeDirection(0);
    };

    const handleTouchMove = (event) => {
      if (!swipeRef.current.tracking) return;
      const touch = event.touches?.[0];
      if (!touch) return;

      const deltaX = Number(touch.clientX || 0) - swipeRef.current.startX;
      const deltaY = Number(touch.clientY || 0) - swipeRef.current.startY;

      if (!swipeRef.current.engaged) {
        if (Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX)) {
          resetGesture();
          return;
        }
        if (Math.abs(deltaX) < FOLDER_SWIPE_START_PX || Math.abs(deltaX) <= (Math.abs(deltaY) + 4)) return;
        swipeRef.current.engaged = true;
      }

      event.preventDefault();
      const clamped = Math.max(
        -FOLDER_SWIPE_MAX_OFFSET_PX,
        Math.min(FOLDER_SWIPE_MAX_OFFSET_PX, deltaX),
      );
      offsetRef.current = clamped;
      setFolderSwipeOffset(clamped);
    };

    const finishGesture = () => {
      if (!swipeRef.current.tracking) return;

      const currentOffset = offsetRef.current;
      const shouldNavigate = swipeRef.current.engaged
        && Math.abs(currentOffset) >= FOLDER_SWIPE_TRIGGER_PX;
      const direction = currentOffset < 0 ? 'next' : 'prev';
      const nextKey = shouldNavigate
        ? resolveFolderSwipeTarget(activeFolderKeyRef.current, direction, customFoldersRef.current)
        : null;

      swipeRef.current = resetSwipeState();
      offsetRef.current = 0;
      setFolderSwipeOffset(0);

      if (shouldNavigate && nextKey) {
        suppressClickUntilRef.current = Date.now() + FOLDER_SWIPE_CLICK_SUPPRESS_MS;
        setFolderSwipeDirection(direction === 'next' ? -1 : 1);
        onFolderChangeRef.current?.(nextKey);
        return;
      }

      setFolderSwipeDirection(0);
    };

    const handleTouchEnd = () => {
      finishGesture();
    };

    const handleTouchCancel = () => {
      resetGesture();
      setFolderSwipeDirection(0);
    };

    node.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    node.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    node.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
    node.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });

    return () => {
      node.removeEventListener('touchstart', handleTouchStart, { capture: true });
      node.removeEventListener('touchmove', handleTouchMove, { capture: true });
      node.removeEventListener('touchend', handleTouchEnd, { capture: true });
      node.removeEventListener('touchcancel', handleTouchCancel, { capture: true });
    };
  }, [enabled, resetGesture, scrollElement]);

  return {
    folderSwipeOffset,
    folderSwipeDirection,
    setScrollElement,
    shouldSuppressListClick,
  };
}
