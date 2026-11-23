import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAT_SIDEBAR_MIN, CHAT_SIDEBAR_MAX, CHAT_SIDEBAR_RAIL, CHAT_SIDEBAR_COMPACT,
  CHAT_THREAD_MIN, CHAT_SIDEBAR_SEARCH_EXPAND, clampSidebarWidth, normalizeSidebarMode,
  persistSidebarLayout, readSidebarLayout, resolveSidebarWidth,
} from './chatSidebarSizing';

export default function useChatSidebarSizing({ enabled, rightPanelWidth = 0 }) {
  const containerRef = useRef(null);
  const [layout, setLayout] = useState(() => readSidebarLayout());
  const [containerWidth, setContainerWidth] = useState(0);
  const [expandedByUser, setExpandedByUser] = useState(false);
  // Временное раскрытие под поиск: режим expanded визуально, но layout.mode
  // и localStorage не трогаются — после закрытия поиска режим восстановится.
  const [searchExpanded, setSearchExpanded] = useState(false);
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
    || containerWidth >= (layout.mode === 'collapsed' ? CHAT_SIDEBAR_RAIL : layout.mode === 'compact' ? CHAT_SIDEBAR_COMPACT : clampSidebarWidth(layout.width)) + 500 + rightPanelWidth);
  const reservedWidth = persistent ? rightPanelWidth : 0;
  const automaticallyCollapsed = containerWidth > 0
    && containerWidth - reservedWidth < CHAT_SIDEBAR_MIN + CHAT_THREAD_MIN;
  const mode = enabled
    ? (searchExpanded ? 'expanded' : (automaticallyCollapsed && !expandedByUser ? 'collapsed' : layout.mode))
    : 'expanded';
  const collapsed = enabled && mode === 'collapsed';
  const compact = enabled && mode === 'compact';
  const setMode = useCallback((next) => {
    const modeNext = normalizeSidebarMode(next);
    setSearchExpanded(false);
    setExpandedByUser(modeNext !== 'collapsed');
    setLayout((current) => ({ ...current, mode: modeNext }));
    window.requestAnimationFrame(() => {
      containerRef.current?.querySelector(`[aria-label="${modeNext === 'collapsed' ? 'Развернуть список чатов' : 'Свернуть список чатов'}"]`)?.focus({ preventScroll: true });
    });
  }, []);
  const setCollapsed = useCallback((next) => setMode(next ? 'collapsed' : 'expanded'), [setMode]);
  const setWidth = useCallback((next) => setLayout((current) => {
    // Явный drag во время поиска — осознанный выбор ширины: выходим из
    // временного режима и сохраняем выбор пользователя.
    setSearchExpanded(false);
    const width = Number(next);
    if (Number.isFinite(width) && width > 0 && width < CHAT_SIDEBAR_MIN) {
      return { ...current, mode: 'compact' };
    }
    return { ...current, width: clampSidebarWidth(next), mode: 'expanded' };
  }), []);
  const context = useMemo(
    () => ({
      collapsed, compact, mode,
      setCollapsed: enabled ? setCollapsed : null,
      setMode: enabled ? setMode : null,
      searchExpanded, setSearchExpanded: enabled ? setSearchExpanded : null,
    }),
    [collapsed, compact, mode, enabled, setCollapsed, setMode, searchExpanded],
  );
  const width = collapsed
    ? CHAT_SIDEBAR_RAIL
    : compact
      ? CHAT_SIDEBAR_COMPACT
      : searchExpanded
        ? Math.max(CHAT_SIDEBAR_RAIL, Math.min(
            CHAT_SIDEBAR_SEARCH_EXPAND,
            containerWidth ? containerWidth - reservedWidth - CHAT_THREAD_MIN : CHAT_SIDEBAR_SEARCH_EXPAND,
          ))
        : resolveSidebarWidth(layout.width, containerWidth, reservedWidth);
  return {
    containerRef, context, width, setWidth, persistent,
    maxWidth: Math.max(CHAT_SIDEBAR_MIN, Math.min(CHAT_SIDEBAR_MAX, containerWidth ? containerWidth - reservedWidth - (persistent ? 500 : CHAT_THREAD_MIN) : CHAT_SIDEBAR_MAX)),
  };
}
