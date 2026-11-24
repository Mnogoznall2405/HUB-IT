import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const INITIAL_ROWS = 40;
// Window edges snap to QUANT-row boundaries: a small scroll (a few rows) never
// changes the mounted slice, so React commits happen on boundary crossings
// only instead of every scroll frame. Cost: a few extra mounted rows.
const QUANT = 16;

// Window-scrolled virtualization for document-flow lists. The My Files list
// scrolls with the page (not an inner scroller), so react-window is not a fit:
// instead we render only the visible slice between two spacer boxes whose
// heights preserve the overall document scroll height. Requires a constant
// row height — enforced by the row components themselves.
export function useWindowVirtualRows({ itemCount, rowHeight, overscan = 8, trackWidth = true }) {
  const containerNodeRef = useRef(null);
  const frameRef = useRef(0);
  const resizeObserverRef = useRef(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(itemCount, INITIAL_ROWS) });
  // Width tracking is opt-in (grid column math): the document settles for a
  // few frames after mount and every sub-pixel width shift would otherwise
  // re-render a list that never reads the value.
  const [containerWidth, setContainerWidth] = useState(0);
  // Parameters via ref: keeps update() identity stable, so itemCount changes do
  // not re-fire layout effects / reattach the container ref mid-commit — the
  // recompute is deferred to rAF instead.
  const paramsRef = useRef({ itemCount, rowHeight, overscan, trackWidth });
  paramsRef.current = { itemCount, rowHeight, overscan, trackWidth };
  // Mirrors of committed vs. last-requested state. A bailout inside setState
  // still costs a full render pass, and ResizeObserver on the document fires
  // on every page layout shift — comparing BEFORE scheduling makes a no-op
  // update free. Two refs are needed because a dropped transition render
  // leaves "requested" ahead of "committed": skipping on the requested value
  // alone could strand a stale window forever.
  const committedRef = useRef({ start: range.start, end: range.end, width: containerWidth });
  const pendingRef = useRef(committedRef.current);
  useLayoutEffect(() => {
    committedRef.current = { start: range.start, end: range.end, width: containerWidth };
  }, [range, containerWidth]);
  const applyRange = useCallback((transition, nextStart, nextEnd, nextWidth) => {
    const committed = committedRef.current;
    const pending = pendingRef.current;
    const sameAsCommitted = committed.start === nextStart && committed.end === nextEnd
      && (!paramsRef.current.trackWidth || Math.abs(committed.width - nextWidth) < 0.5);
    const sameAsPending = pending.start === nextStart && pending.end === nextEnd
      && (!paramsRef.current.trackWidth || Math.abs(pending.width - nextWidth) < 0.5);
    if (sameAsCommitted && sameAsPending) return;
    pendingRef.current = { start: nextStart, end: nextEnd, width: nextWidth };
    const fn = () => {
      if (paramsRef.current.trackWidth) {
        setContainerWidth((prev) => (Math.abs(prev - nextWidth) < 0.5 ? prev : nextWidth));
      }
      setRange((prev) => (prev.start === nextStart && prev.end === nextEnd ? prev : { start: nextStart, end: nextEnd }));
    };
    if (transition) startTransition(fn);
    else fn();
  }, []);

  // transition=true marks the range update non-urgent: while the user keeps
  // scrolling, React may discard an in-flight render of a stale window and go
  // straight to the latest one — without it every QUANT boundary commits
  // synchronously and fast scroll stutters on the mount burst.
  const update = useCallback((transition = false) => {
    const { itemCount: count, rowHeight: rh, overscan: oc } = paramsRef.current;
    const el = containerNodeRef.current;
    if (!el || count <= 0) {
      applyRange(transition, 0, Math.min(count, INITIAL_ROWS), el ? el.getBoundingClientRect().width : widthRef.current);
      return;
    }
    const rect = el.getBoundingClientRect();
    const docTop = rect.top + window.scrollY;
    const w = rect.width;
    const firstVisible = Math.max(0, Math.floor((window.scrollY - docTop) / rh));
    const lastVisible = Math.max(
      firstVisible,
      Math.ceil((window.scrollY + window.innerHeight - docTop) / rh),
    );
    const start = Math.max(0, Math.floor(firstVisible / QUANT) * QUANT - oc);
    const end = Math.min(count, Math.ceil((lastVisible + 1) / QUANT) * QUANT + oc);
    applyRange(transition, start, end, w);
  }, [applyRange]);

  // Stable ref to the latest update(): the callback ref below must keep a
  // constant identity, otherwise React detaches/reattaches it on every
  // itemCount change and each reattach would force a synchronous layout pass.
  const updateRef = useRef(update);
  updateRef.current = update;

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      updateRef.current(true);
    });
  }, []);

  // Callback ref: the container unmounts/remounts on view toggles and loading
  // flips, so a plain ref + mount effect would never recompute the window for
  // a freshly attached node — measure immediately on attach instead.
  const containerRef = useCallback((node) => {
    const prev = containerNodeRef.current;
    if (prev && prev !== node) resizeObserverRef.current?.unobserve(prev);
    containerNodeRef.current = node;
    if (node) {
      resizeObserverRef.current?.observe(node);
      updateRef.current();
    }
  }, []);

  // First paint: compute synchronously so the initial slice is correct without
  // a blank frame. itemCount/rowHeight changes also recompute synchronously —
  // update() is ref-stable so this fires exactly once per navigation, and the
  // corrected slice still lands inside the same frame (a rAF pass would push
  // row appearance one frame later: measured +100ms on first_dom).
  useLayoutEffect(() => {
    updateRef.current();
  }, [itemCount, rowHeight]);

  useEffect(() => {
    window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
    window.addEventListener('resize', scheduleUpdate);
    // The list's document offset shifts when siblings (selection bar, upload
    // card, breadcrumbs, sidebar width) resize — observe the container and the
    // root element to catch those moves without a scroll event.
    const observer = new ResizeObserver(scheduleUpdate);
    resizeObserverRef.current = observer;
    if (containerNodeRef.current) observer.observe(containerNodeRef.current);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('scroll', scheduleUpdate, { capture: true });
      window.removeEventListener('resize', scheduleUpdate);
      observer.disconnect();
      resizeObserverRef.current = null;
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [scheduleUpdate]);

  return {
    containerRef,
    containerWidth,
    start: range.start,
    end: Math.min(range.end, itemCount),
    topSpacerHeight: range.start * rowHeight,
    bottomSpacerHeight: Math.max(0, itemCount - range.end) * rowHeight,
  };
}

// Width of a layout element — drives the column-count math for virtualized
// CSS grids (repeat(auto-fill, minmax(N,1fr)) mirrors floor((w+gap)/(N+gap))).
// Callback ref + lazy observer: the measured element mounts after loading, so
// a mount-time effect would never see it.
export function useElementWidth() {
  const observerRef = useRef(null);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const ref = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const measure = () => {
      const w = node.getBoundingClientRect().width;
      // Compare before setState: a bail inside the updater still renders.
      if (Math.abs(widthRef.current - w) < 0.5) return;
      widthRef.current = w;
      setWidth(w);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [ref, width];
}
