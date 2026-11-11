import { useEffect, useRef, useState } from 'react';

import {
  isMobileMessageLongPress,
  shouldCancelLongPressMove,
  shouldSuppressNativeMessageGesture,
} from './chatBubbleGesturePolicy';

const LONG_PRESS_MS = 420;
const SWIPE_TRIGGER = 38;
const SWIPE_MAX = 52;

export default function useChatBubbleGestures({
  mobileInteractionsEnabled = false,
  compactMobile = false,
  selectionMode = false,
  canToggleSelection = false,
  message,
  attachments = [],
  pureMediaBubble = false,
  onToggleMessageSelection,
  onStartMessageSelection,
  onOpenMessageMenu,
  onReplyMessage,
}) {
  const longPressTimerRef = useRef(null);
  const longPressStartRef = useRef({ x: 0, y: 0 });
  const longPressGestureRef = useRef({ source: '', pointerId: null, handled: false });
  const swipeRef = useRef({ startX: 0, startY: 0, active: false, triggered: false });
  const [swipeDx, setSwipeDx] = useState(0);

  const mobileMessageInteractionsEnabled = isMobileMessageLongPress({
    mobileInteractionsEnabled,
    compactMobile,
  });
  const suppressNativeMessageGesture = shouldSuppressNativeMessageGesture({
    mobileInteractionsEnabled,
    compactMobile,
  });

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressGestureRef.current = { source: '', pointerId: null, handled: longPressGestureRef.current.handled };
  };

  const resetLongPressGesture = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressGestureRef.current = { source: '', pointerId: null, handled: false };
  };

  const toggleSelection = () => {
    if (!message?.id || !canToggleSelection) return;
    onToggleMessageSelection?.(message);
  };

  const runLongPressAction = (target) => {
    if (selectionMode && canToggleSelection) {
      toggleSelection();
      return;
    }
    const hasAttachments = attachments.length > 0 || pureMediaBubble;
    if (compactMobile && hasAttachments) {
      onStartMessageSelection?.(message);
      onOpenMessageMenu?.(message, target);
      return;
    }
    if (typeof onStartMessageSelection === 'function') {
      onStartMessageSelection(message);
      return;
    }
    if (typeof onOpenMessageMenu === 'function') {
      onOpenMessageMenu(message, target);
      return;
    }
    onReplyMessage?.(message);
  };

  const scheduleLongPress = ({ x = 0, y = 0, target = null, pointerId = null, source = 'touch' } = {}) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (longPressTimerRef.current) return;
    if (longPressGestureRef.current.source && longPressGestureRef.current.source !== source) return;
    longPressStartRef.current = {
      x: Number(x || 0),
      y: Number(y || 0),
    };
    longPressGestureRef.current = { source, pointerId, handled: false };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressGestureRef.current = { ...longPressGestureRef.current, handled: true };
      runLongPressAction(target);
    }, LONG_PRESS_MS);
  };

  const startLongPress = (event) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (suppressNativeMessageGesture && event?.cancelable) {
      event.preventDefault();
    }
    const touch = event?.touches?.[0] || null;
    if (compactMobile && touch) {
      swipeRef.current = { startX: touch.clientX, startY: touch.clientY, active: true, triggered: false };
    }
    scheduleLongPress({
      x: Number(touch?.clientX || 0),
      y: Number(touch?.clientY || 0),
      target: event?.currentTarget || null,
      source: 'touch',
    });
  };

  const handleSwipeMove = (event) => {
    if (!compactMobile || !swipeRef.current.active) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = Math.abs(touch.clientY - swipeRef.current.startY);
    if (dy > 20) { swipeRef.current.active = false; setSwipeDx(0); return; }
    if (dx < 0) {
      const clamped = Math.min(Math.abs(dx), SWIPE_MAX);
      setSwipeDx(clamped);
      if (clamped >= SWIPE_TRIGGER && !swipeRef.current.triggered) {
        swipeRef.current.triggered = true;
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }
  };

  const handleSwipeEnd = () => {
    if (!compactMobile) return;
    if (swipeRef.current.triggered) {
      onReplyMessage?.(message);
    }
    swipeRef.current = { startX: 0, startY: 0, active: false, triggered: false };
    setSwipeDx(0);
  };

  const startPointerLongPress = (event) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (event?.pointerType && event.pointerType !== 'touch') return;
    if (suppressNativeMessageGesture && event?.cancelable) {
      event.preventDefault();
    }
    scheduleLongPress({
      x: Number(event?.clientX || 0),
      y: Number(event?.clientY || 0),
      target: event?.currentTarget || null,
      pointerId: event?.pointerId ?? null,
      source: 'pointer',
    });
  };

  const handleLongPressMove = (event) => {
    if (!longPressTimerRef.current) return;
    const touch = event?.touches?.[0] || null;
    if (!touch) {
      resetLongPressGesture();
      return;
    }
    if (shouldCancelLongPressMove({
      startX: longPressStartRef.current.x,
      startY: longPressStartRef.current.y,
      currentX: Number(touch.clientX || 0),
      currentY: Number(touch.clientY || 0),
    })) {
      resetLongPressGesture();
    }
  };

  const handlePointerLongPressMove = (event) => {
    if (!longPressTimerRef.current) return;
    if (event?.pointerType && event.pointerType !== 'touch') return;
    if (longPressGestureRef.current.pointerId !== null && event?.pointerId !== longPressGestureRef.current.pointerId) return;
    if (shouldCancelLongPressMove({
      startX: longPressStartRef.current.x,
      startY: longPressStartRef.current.y,
      currentX: Number(event?.clientX || 0),
      currentY: Number(event?.clientY || 0),
    })) {
      resetLongPressGesture();
    }
  };

  const handleTouchCancel = () => {
    if (!mobileMessageInteractionsEnabled) {
      resetLongPressGesture();
    }
  };

  const handlePointerCancel = () => {
    if (!mobileMessageInteractionsEnabled) {
      resetLongPressGesture();
    }
  };

  const handleClickCapture = (event) => {
    if (longPressGestureRef.current.handled) {
      event.preventDefault();
      event.stopPropagation();
      longPressGestureRef.current = { source: '', pointerId: null, handled: false };
      return;
    }
    if (!selectionMode) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSelection();
  };

  const handleContextMenu = (event) => {
    if (mobileMessageInteractionsEnabled) {
      event.preventDefault();
      event.stopPropagation();
      if (!longPressTimerRef.current && !longPressGestureRef.current.handled) {
        longPressGestureRef.current = { source: 'contextmenu', pointerId: null, handled: true };
        runLongPressAction(event.currentTarget);
      }
      return;
    }
    if (selectionMode && canToggleSelection) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection();
      return;
    }
    if (typeof onOpenMessageMenu !== 'function') return;
    event.preventDefault();
    event.stopPropagation();
    onOpenMessageMenu(message, {
      anchorEl: event.currentTarget,
      anchorPosition: {
        top: Math.round(Number(event.clientY || 0)),
        left: Math.round(Number(event.clientX || 0)),
      },
      anchorReference: 'anchorPosition',
    });
  };

  const handleBubbleClick = (event) => {
    if (longPressGestureRef.current.handled) return;
    onOpenMessageMenu?.(message, event.currentTarget);
  };

  useEffect(() => () => {
    clearLongPress();
  }, []);

  return {
    swipeDx,
    longPressGestureRef,
    mobileMessageInteractionsEnabled,
    suppressNativeMessageGesture,
    toggleSelection,
    clearLongPress,
    handleClickCapture,
    handleContextMenu,
    handleBubbleClick,
    startPointerLongPress,
    handlePointerLongPressMove,
    handlePointerCancel,
    startLongPress,
    handleLongPressMove,
    handleTouchCancel,
    handleSwipeMove,
    handleSwipeEnd,
  };
}
