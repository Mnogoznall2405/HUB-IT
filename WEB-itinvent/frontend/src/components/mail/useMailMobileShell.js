import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildMailMobileHistoryState,
  getMailMobileHistoryKey,
  readMailMobileHistoryState,
} from './mailMobileHistory';

export const MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS = 180;

const MAIL_MOBILE_EDGE_SWIPE_ZONE_PX = 24;
const MAIL_MOBILE_EDGE_SWIPE_LOCK_PX = 10;
const MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX = 72;
const MAIL_MOBILE_EDGE_SWIPE_FLING_VELOCITY_PX_MS = 0.35;

const EDGE_GESTURE_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
].join(', ');

const isElementMatchingSelector = (element, selector) => {
  if (!element || typeof element.closest !== 'function') return false;
  return Boolean(element.closest(selector));
};

const shouldBlockMailEdgeGestureTarget = (target, { blockTableScroll = false } = {}) => {
  if (!target || typeof target !== 'object') return false;
  if (isElementMatchingSelector(target, EDGE_GESTURE_INTERACTIVE_SELECTOR)) return true;
  if (blockTableScroll && isElementMatchingSelector(target, '[data-mail-table-scroll="true"]')) return true;
  return false;
};

const getCurrentHistoryUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

export function useMailMobileShell({
  isMobile,
  selectedId,
  viewMode,
  isPreviewOpen,
  onClearSelection,
  onRestoreSelection,
} = {}) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [previewSwipeOffset, setPreviewSwipeOffset] = useState(0);
  const [previewSwipeTransition, setPreviewSwipeTransition] = useState(false);

  const selectedIdRef = useRef(selectedId);
  const viewModeRef = useRef(viewMode);
  const clearSelectionRef = useRef(onClearSelection);
  const restoreSelectionRef = useRef(onRestoreSelection);
  const previewSwipeRef = useRef(null);
  const previewSwipeTimeoutRef = useRef(null);
  const mobileHistoryReadyRef = useRef(false);
  const mobileHistoryModeRef = useRef('list:closed:none:messages');

  selectedIdRef.current = selectedId;
  viewModeRef.current = viewMode;
  clearSelectionRef.current = onClearSelection;
  restoreSelectionRef.current = onRestoreSelection;

  const readHistoryState = useCallback((state = typeof window !== 'undefined' ? window.history.state : null) => (
    readMailMobileHistoryState(state)
  ), []);

  const writeHistoryState = useCallback((nextState, strategy = 'push') => {
    if (!isMobile || typeof window === 'undefined') return;
    const { nextHistoryState, key } = buildMailMobileHistoryState(window.history.state, nextState);
    if (strategy === 'replace') {
      window.history.replaceState(nextHistoryState, '', getCurrentHistoryUrl());
    } else {
      window.history.pushState(nextHistoryState, '', getCurrentHistoryUrl());
    }
    mobileHistoryModeRef.current = key;
  }, [isMobile]);

  const handleBackToList = useCallback(() => {
    if (isMobile && mobileHistoryReadyRef.current && typeof window !== 'undefined') {
      const currentState = readHistoryState();
      if (currentState?.view === 'preview') {
        window.history.back();
        return;
      }
    }
    const currentMode = viewModeRef.current === 'conversations' ? 'conversations' : 'messages';
    clearSelectionRef.current?.({
      mode: currentMode,
      restoreListState: Boolean(isMobile && currentMode === 'messages'),
    });
  }, [isMobile, readHistoryState]);

  const clearPreviewSwipeTimeout = useCallback(() => {
    if (!previewSwipeTimeoutRef.current || typeof window === 'undefined') return;
    window.clearTimeout(previewSwipeTimeoutRef.current);
    previewSwipeTimeoutRef.current = null;
  }, []);

  const resetPreviewSwipe = useCallback(({ animate = false } = {}) => {
    clearPreviewSwipeTimeout();
    previewSwipeRef.current = null;
    if (!animate) {
      setPreviewSwipeTransition(false);
      setPreviewSwipeOffset(0);
      return;
    }
    setPreviewSwipeTransition(true);
    setPreviewSwipeOffset(0);
    if (typeof window !== 'undefined') {
      previewSwipeTimeoutRef.current = window.setTimeout(() => {
        setPreviewSwipeTransition(false);
        previewSwipeTimeoutRef.current = null;
      }, MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS);
    }
  }, [clearPreviewSwipeTimeout]);

  const commitPreviewSwipeClose = useCallback((screenWidth = 0) => {
    clearPreviewSwipeTimeout();
    previewSwipeRef.current = null;
    const targetOffset = Math.max(
      Number(screenWidth || 0),
      Number(typeof window !== 'undefined' ? window.innerWidth : 0),
      MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX,
    );
    setPreviewSwipeTransition(true);
    setPreviewSwipeOffset(targetOffset);
    if (typeof window !== 'undefined') {
      previewSwipeTimeoutRef.current = window.setTimeout(() => {
        setPreviewSwipeTransition(false);
        setPreviewSwipeOffset(0);
        previewSwipeTimeoutRef.current = null;
        handleBackToList();
      }, MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS);
    } else {
      setPreviewSwipeTransition(false);
      setPreviewSwipeOffset(0);
      handleBackToList();
    }
  }, [clearPreviewSwipeTimeout, handleBackToList]);

  const handlePreviewEdgeTouchStart = useCallback((event) => {
    if (!isPreviewOpen) return;
    const firstTouch = event.touches?.[0];
    if (!firstTouch || firstTouch.clientX > MAIL_MOBILE_EDGE_SWIPE_ZONE_PX) return;
    if (shouldBlockMailEdgeGestureTarget(event.target, { blockTableScroll: true })) return;
    clearPreviewSwipeTimeout();
    setPreviewSwipeTransition(false);
    previewSwipeRef.current = {
      startX: firstTouch.clientX,
      startY: firstTouch.clientY,
      lastX: firstTouch.clientX,
      startTime: Date.now(),
      locked: false,
      width: Math.max(
        Number(event.currentTarget?.clientWidth || 0),
        Number(typeof window !== 'undefined' ? window.innerWidth : 0),
      ),
    };
  }, [clearPreviewSwipeTimeout, isPreviewOpen]);

  const handlePreviewEdgeTouchMove = useCallback((event) => {
    const gesture = previewSwipeRef.current;
    if (!gesture) return;
    const firstTouch = event.touches?.[0];
    if (!firstTouch) return;
    const deltaX = firstTouch.clientX - gesture.startX;
    const deltaY = firstTouch.clientY - gesture.startY;
    if (!gesture.locked) {
      if (Math.abs(deltaX) < MAIL_MOBILE_EDGE_SWIPE_LOCK_PX && Math.abs(deltaY) < MAIL_MOBILE_EDGE_SWIPE_LOCK_PX) {
        return;
      }
      if (deltaX <= 0 || Math.abs(deltaY) > Math.abs(deltaX)) {
        resetPreviewSwipe();
        return;
      }
      gesture.locked = true;
    }
    gesture.lastX = firstTouch.clientX;
    const nextOffset = Math.max(0, Math.min(deltaX, gesture.width || deltaX));
    setPreviewSwipeTransition(false);
    setPreviewSwipeOffset(nextOffset);
    if (event.cancelable) {
      event.preventDefault();
    }
  }, [resetPreviewSwipe]);

  const handlePreviewEdgeTouchEnd = useCallback((event) => {
    const gesture = previewSwipeRef.current;
    previewSwipeRef.current = null;
    if (!gesture?.locked) {
      resetPreviewSwipe();
      return;
    }
    const changedTouch = event.changedTouches?.[0];
    const finalX = changedTouch?.clientX ?? gesture.lastX;
    const deltaX = Math.max(0, finalX - gesture.startX);
    const durationMs = Math.max(1, Date.now() - gesture.startTime);
    const velocity = deltaX / durationMs;
    if (deltaX >= MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX || velocity >= MAIL_MOBILE_EDGE_SWIPE_FLING_VELOCITY_PX_MS) {
      commitPreviewSwipeClose(gesture.width);
      return;
    }
    resetPreviewSwipe({ animate: deltaX > 0 });
  }, [commitPreviewSwipeClose, resetPreviewSwipe]);

  useEffect(() => {
    if (!isPreviewOpen) {
      resetPreviewSwipe();
    }
  }, [isPreviewOpen, resetPreviewSwipe]);

  useEffect(() => {
    if (!isMobile) {
      setMobileNavigationOpen(false);
      mobileHistoryReadyRef.current = false;
      mobileHistoryModeRef.current = 'list:closed:none:messages';
      return;
    }
    if (typeof window === 'undefined') return;
    const existingState = readHistoryState();
    if (existingState) {
      mobileHistoryReadyRef.current = true;
      mobileHistoryModeRef.current = getMailMobileHistoryKey(existingState);
      return;
    }
    writeHistoryState({
      view: 'list',
      drawerOpen: false,
      selectedId: '',
      selectionMode: viewModeRef.current,
    }, 'replace');
    if (selectedIdRef.current) {
      writeHistoryState({
        view: 'preview',
        drawerOpen: false,
        selectedId: selectedIdRef.current,
        selectionMode: viewModeRef.current,
      }, 'push');
    }
    mobileHistoryReadyRef.current = true;
  }, [isMobile, readHistoryState, writeHistoryState]);

  useEffect(() => {
    if (isMobile && selectedId) {
      setMobileNavigationOpen(false);
    }
  }, [isMobile, selectedId]);

  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return;
    const nextState = selectedId
      ? {
          view: 'preview',
          drawerOpen: false,
          selectedId,
          selectionMode: viewMode,
        }
      : {
          view: 'list',
          drawerOpen: Boolean(mobileNavigationOpen),
          selectedId: '',
          selectionMode: viewMode,
        };
    const currentState = readHistoryState();
    const currentKey = currentState ? getMailMobileHistoryKey(currentState) : mobileHistoryModeRef.current;
    const nextKey = getMailMobileHistoryKey(nextState);
    if (currentKey === nextKey) return;
    writeHistoryState(nextState, 'push');
  }, [
    isMobile,
    mobileNavigationOpen,
    readHistoryState,
    selectedId,
    viewMode,
    writeHistoryState,
  ]);

  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return undefined;
    const handlePopState = (event) => {
      const nextState = readHistoryState(event.state);
      if (!nextState) return;
      mobileHistoryModeRef.current = getMailMobileHistoryKey(nextState);
      if (nextState.view === 'preview' && nextState.selectedId) {
        setMobileNavigationOpen(false);
        selectedIdRef.current = nextState.selectedId;
        viewModeRef.current = nextState.selectionMode;
        restoreSelectionRef.current?.(nextState);
        return;
      }
      setMobileNavigationOpen(Boolean(nextState.drawerOpen));
      if (selectedIdRef.current) {
        selectedIdRef.current = '';
        const currentMode = viewModeRef.current === 'conversations' ? 'conversations' : 'messages';
        clearSelectionRef.current?.({
          mode: currentMode,
          restoreListState: currentMode === 'messages',
        });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobile, readHistoryState]);

  useEffect(() => () => {
    clearPreviewSwipeTimeout();
  }, [clearPreviewSwipeTimeout]);

  const closeMobileNavigationIfNeeded = useCallback(() => {
    if (isMobile) setMobileNavigationOpen(false);
  }, [isMobile]);

  return {
    closeMobileNavigationIfNeeded,
    handleBackToList,
    mobileNavigationOpen,
    mobilePreviewSwipeAnimationMs: MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS,
    mobilePreviewSwipeOffset: previewSwipeOffset,
    mobilePreviewSwipeTransition: previewSwipeTransition,
    previewEdgeTouchHandlers: {
      onTouchStartCapture: handlePreviewEdgeTouchStart,
      onTouchMoveCapture: handlePreviewEdgeTouchMove,
      onTouchEndCapture: handlePreviewEdgeTouchEnd,
      onTouchCancelCapture: handlePreviewEdgeTouchEnd,
    },
    setMobileNavigationOpen,
  };
}

export default useMailMobileShell;
