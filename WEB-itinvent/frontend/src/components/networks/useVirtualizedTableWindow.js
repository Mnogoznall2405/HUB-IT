import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function buildOffsets(itemHeights) {
  const offsets = [0];
  for (const height of itemHeights) {
    offsets.push(offsets[offsets.length - 1] + Math.max(0, Number(height || 0)));
  }
  return offsets;
}

function findIndexForOffset(offsets, target) {
  if (!offsets.length) return 0;
  let low = 0;
  let high = offsets.length - 1;
  const safeTarget = Math.max(0, Number(target || 0));

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (offsets[mid] <= safeTarget) low = mid;
    else high = mid - 1;
  }

  return low;
}

export function useVirtualizedTableWindow({
  itemHeights,
  enabled,
  overscanPx = 320,
  viewportFallback = 720,
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const offsets = useMemo(() => buildOffsets(itemHeights), [itemHeights]);
  const itemCount = itemHeights.length;
  const totalHeight = offsets[offsets.length - 1] || 0;

  const handleScroll = useCallback((event) => {
    if (!enabled) return;
    setScrollTop(event.currentTarget.scrollTop || 0);
  }, [enabled]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateViewport = () => {
      setViewportHeight(node.clientHeight || 0);
      setContainerWidth(node.clientWidth || 0);
      if (!enabled) return;
      setScrollTop(node.scrollTop || 0);
    };

    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateViewport());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [enabled, itemCount]);

  return useMemo(() => {
    if (!enabled || itemCount === 0) {
      return {
        containerRef,
        handleScroll,
        scrollTop,
        viewportHeight,
        containerWidth,
        startIndex: 0,
        endIndex: itemCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        totalHeight,
      };
    }

    const viewport = viewportHeight > 0 ? viewportHeight : viewportFallback;
    const startIndex = Math.min(itemCount, findIndexForOffset(offsets, Math.max(0, scrollTop - overscanPx)));
    const endBoundary = Math.min(totalHeight, scrollTop + viewport + overscanPx);
    const endIndex = Math.min(itemCount, findIndexForOffset(offsets, endBoundary) + 1);

    return {
      containerRef,
      handleScroll,
      scrollTop,
      viewportHeight,
      containerWidth,
      startIndex,
      endIndex,
      topSpacerHeight: offsets[startIndex] || 0,
      bottomSpacerHeight: Math.max(0, totalHeight - (offsets[endIndex] || 0)),
      totalHeight,
    };
  }, [
    enabled,
    handleScroll,
    itemCount,
    offsets,
    overscanPx,
    scrollTop,
    totalHeight,
    containerWidth,
    viewportFallback,
    viewportHeight,
  ]);
}
