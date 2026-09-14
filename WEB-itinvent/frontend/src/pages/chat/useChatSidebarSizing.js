import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAT_SIDEBAR_MIN, CHAT_SIDEBAR_MAX, CHAT_SIDEBAR_RAIL, CHAT_THREAD_MIN,
  clampSidebarWidth, persistSidebarLayout, readSidebarLayout, resolveSidebarWidth,
} from './chatSidebarSizing';

export default function useChatSidebarSizing({ enabled, rightPanelWidth = 0 }) {
  const containerRef = useRef(null);
  const [layout, setLayout] = useState(() => readSidebarLayout());
  const [containerWidth, setContainerWidth] = useState(0);
  const [expandedByUser, setExpandedByUser] = useState(false);
  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined;
    const node = containerRef.current;
    const measure = () => setContainerWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => { if (enabled) persistSidebarLayout(layout); }, [enabled, layout]);
  const persistent = rightPanelWidth > 0 && (!containerWidth
    || containerWidth >= (layout.collapsed ? CHAT_SIDEBAR_RAIL : clampSidebarWidth(layout.width)) + 500 + rightPanelWidth);
  const reservedWidth = persistent ? rightPanelWidth : 0;
  const automaticallyCollapsed = containerWidth > 0
    && containerWidth - reservedWidth < CHAT_SIDEBAR_MIN + CHAT_THREAD_MIN;
  const collapsed = enabled && (layout.collapsed || (automaticallyCollapsed && !expandedByUser));
  const setCollapsed = useCallback((next) => {
    setExpandedByUser(!next);
    setLayout((current) => ({ ...current, collapsed: next }));
    window.requestAnimationFrame(() => {
      containerRef.current?.querySelector(`[aria-label="${next ? 'Развернуть список чатов' : 'Свернуть список чатов'}"]`)?.focus({ preventScroll: true });
    });
  }, []);
  const setWidth = useCallback((next) => setLayout((current) => ({ ...current, width: clampSidebarWidth(next), collapsed: false })), []);
  const context = useMemo(() => ({ collapsed, setCollapsed: enabled ? setCollapsed : null }), [collapsed, enabled, setCollapsed]);
  const width = collapsed ? CHAT_SIDEBAR_RAIL : resolveSidebarWidth(layout.width, containerWidth, reservedWidth);
  return {
    containerRef, context, width, setWidth, persistent,
    maxWidth: Math.max(CHAT_SIDEBAR_MIN, Math.min(CHAT_SIDEBAR_MAX, containerWidth ? containerWidth - reservedWidth - (persistent ? 500 : CHAT_THREAD_MIN) : CHAT_SIDEBAR_MAX)),
  };
}
