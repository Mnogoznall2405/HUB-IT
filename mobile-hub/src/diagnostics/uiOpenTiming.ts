// TEMPORARY performance instrumentation: how long screens, sheets and panels take
// to appear (render start -> second painted frame). Remove this file, its summary
// field and the useUiOpenTiming() calls once the app is confirmed fast.
// Fixed names and numbers only — never identifiers, titles or content.
import { useEffect, useRef } from 'react';
import type { ChatTimingStats } from './chatSendTiming';

export type UiOpenStats = ChatTimingStats & { maxMs: number | null; slow300: number };

const MAX_NAMES = 32;
const MAX_SAMPLES = 40;
const SLOW_OPEN_MS = 300;
const NAME_PATTERN = /^[a-z][a-z0-9:-]{0,31}$/;

const samples = new Map<string, number[]>();
const slowCounts = new Map<string, number>();

export function noteUiOpen(name: string, durationMs: number): void {
  if (!NAME_PATTERN.test(name) || !Number.isFinite(durationMs) || durationMs < 0) return;
  let list = samples.get(name);
  if (!list) {
    if (samples.size >= MAX_NAMES) return;
    list = [];
    samples.set(name, list);
  }
  list.push(Math.trunc(durationMs));
  while (list.length > MAX_SAMPLES) list.shift();
  if (durationMs >= SLOW_OPEN_MS) slowCounts.set(name, (slowCounts.get(name) ?? 0) + 1);
}

export function resetUiOpenTiming(): void {
  samples.clear();
  slowCounts.clear();
}

export function getUiOpenSummary(): Record<string, UiOpenStats> {
  const result: Record<string, UiOpenStats> = {};
  for (const [name, list] of samples) {
    const sorted = list.slice().sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.ceil(p * sorted.length) - 1] ?? null;
    result[name] = {
      count: sorted.length,
      p50: pick(0.5),
      p95: pick(0.95),
      maxMs: sorted.length ? sorted[sorted.length - 1] : null,
      slow300: slowCounts.get(name) ?? 0,
    };
  }
  return result;
}

/** Measures every closed -> open flip of `open` until the second painted frame. */
export function useUiOpenTiming(name: string, open: boolean): void {
  const wasOpen = useRef(false);
  const startedAt = useRef(0);
  // Render phase: this is the earliest moment we know the open was requested.
  if (open && !wasOpen.current) startedAt.current = Date.now();
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return undefined;
    const startedAtMs = startedAt.current;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) noteUiOpen(name, Date.now() - startedAtMs);
      });
    });
    return () => { cancelled = true; };
  }, [name, open]);
}

/** Measures every change of `name` (e.g. a route change) until the second painted frame. */
export function useUiKeyTiming(name: string): void {
  const previous = useRef<string | null>(null);
  const startedAt = useRef(0);
  if (previous.current !== name) startedAt.current = Date.now();
  useEffect(() => {
    const changed = previous.current !== name;
    const first = previous.current === null;
    previous.current = name;
    // The very first value is app start, not a navigation.
    if (!changed || first) return undefined;
    const startedAtMs = startedAt.current;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) noteUiOpen(name, Date.now() - startedAtMs);
      });
    });
    return () => { cancelled = true; };
  }, [name]);
}
