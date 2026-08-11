import { useEffect, useRef, useState } from 'react';

export const CHAT_STICKER_PRELOAD_ROOT_MARGIN = '240px 0px';
export const CHAT_STICKER_UNLOAD_DELAY_MS = 4000;

const proximitySubscribers = new Map();
const pageVisibilitySubscribers = new Set();
let sharedProximityObserver = null;
let pageVisibilityListenerAttached = false;

const hasIntersectionObserver = () => (
  typeof globalThis !== 'undefined'
  && typeof globalThis.IntersectionObserver === 'function'
);

const isPageVisible = () => (
  typeof document === 'undefined' || document.visibilityState !== 'hidden'
);

const getSharedProximityObserver = () => {
  if (!hasIntersectionObserver()) return null;
  if (sharedProximityObserver) return sharedProximityObserver;
  sharedProximityObserver = new globalThis.IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        proximitySubscribers.get(entry.target)?.(Boolean(entry.isIntersecting));
      });
    },
    {
      rootMargin: CHAT_STICKER_PRELOAD_ROOT_MARGIN,
      threshold: 0.01,
    },
  );
  return sharedProximityObserver;
};

const subscribeToProximity = (node, callback) => {
  const observer = getSharedProximityObserver();
  if (!observer) {
    callback(true);
    return () => {};
  }
  proximitySubscribers.set(node, callback);
  observer.observe(node);
  return () => {
    observer.unobserve(node);
    proximitySubscribers.delete(node);
    if (proximitySubscribers.size === 0) {
      observer.disconnect();
      sharedProximityObserver = null;
    }
  };
};

const publishPageVisibility = () => {
  const visible = isPageVisible();
  pageVisibilitySubscribers.forEach((callback) => callback(visible));
};

const subscribeToPageVisibility = (callback) => {
  if (typeof document === 'undefined') return () => {};
  pageVisibilitySubscribers.add(callback);
  if (!pageVisibilityListenerAttached) {
    document.addEventListener('visibilitychange', publishPageVisibility);
    pageVisibilityListenerAttached = true;
  }
  callback(isPageVisible());
  return () => {
    pageVisibilitySubscribers.delete(callback);
    if (pageVisibilitySubscribers.size === 0 && pageVisibilityListenerAttached) {
      document.removeEventListener('visibilitychange', publishPageVisibility);
      pageVisibilityListenerAttached = false;
    }
  };
};

export default function useChatStickerMediaActivity({
  rootRef,
  enabled = true,
  eager = false,
  unloadDelayMs = CHAT_STICKER_UNLOAD_DELAY_MS,
}) {
  const initiallyActive = Boolean(!enabled || eager || !hasIntersectionObserver());
  const [isNearViewport, setIsNearViewport] = useState(initiallyActive);
  const [shouldMountMedia, setShouldMountMedia] = useState(initiallyActive);
  const [pageVisible, setPageVisible] = useState(isPageVisible);
  const unloadTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled || eager) {
      setIsNearViewport(true);
      setShouldMountMedia(true);
      return undefined;
    }
    const node = rootRef?.current;
    if (!node) return undefined;
    const unsubscribe = subscribeToProximity(node, (nearViewport) => {
      setIsNearViewport(nearViewport);
      if (nearViewport) {
        if (unloadTimerRef.current !== null) {
          globalThis.clearTimeout(unloadTimerRef.current);
          unloadTimerRef.current = null;
        }
        setShouldMountMedia(true);
        return;
      }
      if (unloadTimerRef.current !== null) globalThis.clearTimeout(unloadTimerRef.current);
      unloadTimerRef.current = globalThis.setTimeout(() => {
        unloadTimerRef.current = null;
        setShouldMountMedia(false);
      }, Math.max(0, Number(unloadDelayMs) || 0));
    });
    return () => {
      unsubscribe();
      if (unloadTimerRef.current !== null) {
        globalThis.clearTimeout(unloadTimerRef.current);
        unloadTimerRef.current = null;
      }
    };
  }, [eager, enabled, rootRef, unloadDelayMs]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToPageVisibility(setPageVisible);
  }, [enabled]);

  useEffect(() => () => {
    if (unloadTimerRef.current !== null) {
      globalThis.clearTimeout(unloadTimerRef.current);
      unloadTimerRef.current = null;
    }
  }, []);

  return {
    shouldMountMedia: Boolean(shouldMountMedia),
    shouldPlayMedia: Boolean((eager || isNearViewport) && pageVisible),
  };
}
