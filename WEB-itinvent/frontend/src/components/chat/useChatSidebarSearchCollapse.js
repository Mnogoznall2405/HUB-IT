import { useCallback, useEffect, useRef, useState } from 'react';

export const CHAT_SIDEBAR_SEARCH_COLLAPSE_THRESHOLD = 64;
export const CHAT_SIDEBAR_SEARCH_COLLAPSE_RANGE = 16;

export function useChatSidebarSearchCollapse({
  scrollElement = null,
  enabled = false,
  searchActive = false,
  searchFocused = false,
  reducedMotion = false,
} = {}) {
  const [collapseProgress, setCollapseProgress] = useState(0);
  const [forcedExpanded, setForcedExpanded] = useState(false);
  const frameRef = useRef(null);
  const scrollElementRef = useRef(scrollElement);
  scrollElementRef.current = scrollElement;

  const isForcedOpen = searchActive || searchFocused || forcedExpanded;

  const updateFromScroll = useCallback(() => {
    frameRef.current = null;
    const node = scrollElementRef.current;
    if (!enabled || !node || isForcedOpen) {
      setCollapseProgress(0);
      return;
    }
    const scrollTop = Number(node.scrollTop || 0);
    const start = CHAT_SIDEBAR_SEARCH_COLLAPSE_THRESHOLD - CHAT_SIDEBAR_SEARCH_COLLAPSE_RANGE;
    const progress = Math.min(1, Math.max(0, (scrollTop - start) / CHAT_SIDEBAR_SEARCH_COLLAPSE_RANGE));
    setCollapseProgress(reducedMotion ? (progress >= 1 ? 1 : 0) : progress);
  }, [enabled, isForcedOpen, reducedMotion]);

  useEffect(() => {
    if (!enabled) {
      setCollapseProgress(0);
      setForcedExpanded(false);
      return undefined;
    }
    const node = scrollElement;
    if (!node) return undefined;

    const schedule = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(updateFromScroll);
    };

    schedule();
    node.addEventListener('scroll', schedule, { passive: true });
    return () => {
      node.removeEventListener('scroll', schedule);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [enabled, scrollElement, updateFromScroll]);

  useEffect(() => {
    if (searchActive || searchFocused) {
      setCollapseProgress(0);
    }
  }, [searchActive, searchFocused]);

  useEffect(() => {
    if (searchFocused && forcedExpanded) {
      setForcedExpanded(false);
    }
  }, [forcedExpanded, searchFocused]);

  const expandSearch = useCallback(() => {
    const node = scrollElementRef.current;
    if (node) {
      node.scrollTop = 0;
    }
    setForcedExpanded(true);
    setCollapseProgress(0);
  }, []);

  const effectiveProgress = isForcedOpen ? 0 : collapseProgress;
  const isSearchCollapsed = enabled && !isForcedOpen && effectiveProgress >= 0.98;

  return {
    collapseProgress: effectiveProgress,
    expandSearch,
    isSearchCollapsed,
  };
}
