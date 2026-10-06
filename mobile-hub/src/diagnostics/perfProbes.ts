// TEMPORARY performance instrumentation (with uiOpenTiming.ts): request time per
// endpoint template, commit time per screen, realtime event flow and Hermes heap/GC.
// Remove this file, the `perf` summary field and its call sites once the app is fast.
// Fixed names and numbers only — never identifiers, titles, params or content.
import { useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

export type PerfStats = {
  /** Samples kept (last 60) — percentiles come from these. */
  count: number;
  /** Every call since the session start. */
  total: number;
  p50: number | null;
  p95: number | null;
  maxMs: number | null;
  slow: number;
};
export type EndpointStats = PerfStats & { errors: number };
export type PerfSummary = {
  /** Request duration (ms) per `METHOD /path/:id` template; slow = >=1000 ms. */
  endpoints: Record<string, EndpointStats>;
  /** Render-to-commit time (ms) of a screen/list subtree; slow = >=50 ms. */
  renders: Record<string, PerfStats>;
  /** JS runtime start -> first routed screen mounted (ms), null until then. */
  startupMs: number | null;
  /** Own background work (cache reads/writes, list updates): time spent per kind. */
  work: Record<string, PerfStats>;
  /** For every JS stall >=150 ms: which kind of work overlapped it most ('none' = nothing we track). */
  stallCulprits: Record<string, number>;
  realtime: { total: number; peakPerSecond: number; byType: Record<string, number> };
  hermes: {
    supported: boolean;
    samples: number;
    heapBytesFirst: number | null;
    heapBytesLast: number | null;
    heapBytesMax: number | null;
    gcCount: number | null;
    gcTimeMs: number | null;
  };
};

const MAX_SAMPLES = 60;
const MAX_ENDPOINTS = 40;
const MAX_RENDER_NAMES = 16;
const MAX_EVENT_TYPES = 24;
const MAX_WORK_NAMES = 24;
const MAX_WORK_INTERVALS = 64;
const WORK_NAME = /^[a-z][a-z0-9:-]{0,31}$/;
const SLOW_WORK_MS = 100;
const SLOW_REQUEST_MS = 1000;
const SLOW_RENDER_MS = 50;
const ENDPOINT_METHOD = /^[a-z]{3,7}$/;
const RENDER_NAME = /^[a-z][a-z0-9:-]{0,31}$/;
const EVENT_TYPE = /^[a-z][a-z0-9._:-]{0,39}$/;
const HEAP_SAMPLE_MS = 5_000;

type Series = { values: number[]; total: number; slow: number; errors: number };

const endpoints = new Map<string, Series>();
const renders = new Map<string, Series>();
const realtimeTypes = new Map<string, number>();
const workSeries = new Map<string, Series>();
const workIntervals: Array<{ name: string; start: number; end: number }> = [];
const stallCulprits = new Map<string, number>();
const requestStartedAt = new WeakMap<object, number>();
// performance.now() counts from device boot on Android, so measure from this module's
// evaluation (the first thing the app bundle loads) instead.
const moduleLoadedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : NaN;
let startupMs: number | null = null;
let realtimeTotal = 0;
let realtimePeak = 0;
let realtimeBucketSecond = 0;
let realtimeBucketCount = 0;
const heap = {
  samples: 0, first: null as number | null, last: null as number | null, max: null as number | null,
  gcFirst: null as number | null, gcLast: null as number | null,
  gcTimeFirst: null as number | null, gcTimeLast: null as number | null,
};
let heapTimer: ReturnType<typeof setInterval> | null = null;

function record(map: Map<string, Series>, key: string, limit: number, ms: number, slowAt: number, failed = false): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  let series = map.get(key);
  if (!series) {
    if (map.size >= limit) return;
    series = { values: [], total: 0, slow: 0, errors: 0 };
    map.set(key, series);
  }
  series.total += 1;
  series.values.push(Math.trunc(ms));
  while (series.values.length > MAX_SAMPLES) series.values.shift();
  if (ms >= slowAt) series.slow += 1;
  if (failed) series.errors += 1;
}

function summarize(series: Series): EndpointStats {
  const sorted = series.values.slice().sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.ceil(p * sorted.length) - 1] ?? null;
  return {
    count: sorted.length,
    total: series.total,
    p50: pick(0.5),
    p95: pick(0.95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    slow: series.slow,
    errors: series.errors,
  };
}

/** `GET /chat/conversations/:id/messages` — ids, queries and free text never survive. */
export function endpointTemplate(method: unknown, url: unknown): string | null {
  const verb = String(method || 'get').toLowerCase();
  if (!ENDPOINT_METHOD.test(verb)) return null;
  const path = String(url || '').split('?')[0].split('#')[0].replace(/^https?:\/\/[^/]+/i, '');
  const segments = path.split('/').filter(Boolean).slice(0, 6).map((segment) =>
    /^[a-z][a-z_-]{0,23}$/.test(segment) ? segment : ':id');
  if (!segments.length) return null;
  return `${verb.toUpperCase()} /${segments.join('/')}`;
}

export function noteRequestStart(config: object | undefined, at: number = Date.now()): void {
  if (config && typeof config === 'object') requestStartedAt.set(config, at);
}

export function noteRequestEnd(
  config: { method?: unknown; url?: unknown } | undefined, failed: boolean, at: number = Date.now(),
): void {
  if (!config || typeof config !== 'object') return;
  const startedAt = requestStartedAt.get(config);
  if (startedAt === undefined) return;
  requestStartedAt.delete(config);
  const key = endpointTemplate(config.method, config.url);
  if (key) record(endpoints, key, MAX_ENDPOINTS, at - startedAt, SLOW_REQUEST_MS, failed);
}

export function noteRenderCommit(name: string, ms: number): void {
  if (!RENDER_NAME.test(name)) return;
  record(renders, name, MAX_RENDER_NAMES, ms, SLOW_RENDER_MS);
}

/** Time from this component's render to its layout effect = render + commit of the
 * whole subtree (siblings rendered after it included), so it is an upper bound. */
export function useRenderTiming(name: string): void {
  const startedAt = Date.now();
  const startRef = useRef(startedAt);
  startRef.current = startedAt;
  useLayoutEffect(() => {
    noteRenderCommit(name, Date.now() - startRef.current);
  });
}

/** Records a finished piece of our own work, so a later JS stall can be matched with it. */
export function noteWork(name: string, startMs: number, endMs: number = Date.now()): void {
  if (!WORK_NAME.test(name) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return;
  record(workSeries, name, MAX_WORK_NAMES, endMs - startMs, SLOW_WORK_MS);
  workIntervals.push({ name, start: startMs, end: endMs });
  while (workIntervals.length > MAX_WORK_INTERVALS) workIntervals.shift();
}

/** Starts timing a piece of work; call the returned function when it is done. */
export function trackWork(name: string): () => void {
  const startedAt = Date.now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    noteWork(name, startedAt);
  };
}

/** Work kinds overlapping [from, to], biggest first, as `{ name, ms }`. */
export function overlappingWork(from: number, to: number): Array<{ name: string; ms: number }> {
  const byName = new Map<string, number>();
  for (const interval of workIntervals) {
    const overlap = Math.min(interval.end, to) - Math.max(interval.start, from);
    if (overlap > 0) byName.set(interval.name, (byName.get(interval.name) ?? 0) + overlap);
  }
  return [...byName].map(([name, ms]) => ({ name, ms: Math.trunc(ms) })).sort((a, b) => b.ms - a.ms).slice(0, 3);
}

/** Attributes a finished stall to the work that overlapped it most. */
export function noteStallCulprit(from: number, to: number): string {
  const name = overlappingWork(from, to)[0]?.name ?? 'none';
  if (stallCulprits.has(name) || stallCulprits.size < MAX_WORK_NAMES) {
    stallCulprits.set(name, (stallCulprits.get(name) ?? 0) + 1);
  }
  return name;
}

/** Called once when the first routed screen is mounted. */
export function noteStartupReady(): void {
  if (startupMs !== null) return;
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : NaN;
  if (Number.isFinite(now) && Number.isFinite(moduleLoadedAt) && now >= moduleLoadedAt) startupMs = Math.trunc(now - moduleLoadedAt);
}

export function noteRealtimeEvent(type: unknown, at: number = Date.now()): void {
  realtimeTotal += 1;
  const second = Math.trunc(at / 1000);
  if (second !== realtimeBucketSecond) {
    realtimeBucketSecond = second;
    realtimeBucketCount = 0;
  }
  realtimeBucketCount += 1;
  if (realtimeBucketCount > realtimePeak) realtimePeak = realtimeBucketCount;
  const name = String(type || '');
  if (!EVENT_TYPE.test(name)) return;
  if (!realtimeTypes.has(name) && realtimeTypes.size >= MAX_EVENT_TYPES) return;
  realtimeTypes.set(name, (realtimeTypes.get(name) ?? 0) + 1);
}

type HermesStats = Record<string, unknown>;

function readHermesStats(): HermesStats | null {
  try {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } }).HermesInternal;
    const stats = hermes?.getInstrumentedStats?.();
    return stats && typeof stats === 'object' ? stats : null;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export function sampleHermesHeap(stats: HermesStats | null = readHermesStats()): void {
  if (!stats) return;
  const heapBytes = finiteNumber(stats.js_heapSize ?? stats.js_allocatedBytes);
  if (heapBytes === null) return;
  heap.samples += 1;
  heap.first ??= heapBytes;
  heap.last = heapBytes;
  heap.max = Math.max(heap.max ?? 0, heapBytes);
  const gcCount = finiteNumber(stats.js_numGCs);
  const gcTime = finiteNumber(stats.js_gcTime);
  if (gcCount !== null) { heap.gcFirst ??= gcCount; heap.gcLast = gcCount; }
  if (gcTime !== null) { heap.gcTimeFirst ??= gcTime; heap.gcTimeLast = gcTime; }
}

export function startPerfSampler(): void {
  if (heapTimer || Platform.OS === 'web') return;
  sampleHermesHeap();
  heapTimer = setInterval(() => sampleHermesHeap(), HEAP_SAMPLE_MS);
}

export function stopPerfSampler(): void {
  if (heapTimer) clearInterval(heapTimer);
  heapTimer = null;
}

export function resetPerfProbes(): void {
  endpoints.clear();
  renders.clear();
  realtimeTypes.clear();
  workSeries.clear();
  workIntervals.length = 0;
  stallCulprits.clear();
  realtimeTotal = 0;
  realtimePeak = 0;
  realtimeBucketSecond = 0;
  realtimeBucketCount = 0;
  Object.assign(heap, {
    samples: 0, first: null, last: null, max: null,
    gcFirst: null, gcLast: null, gcTimeFirst: null, gcTimeLast: null,
  });
}

export function getPerfSummary(): PerfSummary {
  const delta = (first: number | null, last: number | null) =>
    (first !== null && last !== null ? Math.max(0, last - first) : null);
  return {
    startupMs,
    endpoints: Object.fromEntries([...endpoints].map(([key, series]) => [key, summarize(series)])),
    renders: Object.fromEntries([...renders].map(([key, series]) => {
      const { errors: _errors, ...rest } = summarize(series);
      return [key, rest];
    })),
    work: Object.fromEntries([...workSeries].map(([key, series]) => {
      const { errors: _errors, ...rest } = summarize(series);
      return [key, rest];
    })),
    stallCulprits: Object.fromEntries(stallCulprits),
    realtime: {
      total: realtimeTotal,
      peakPerSecond: realtimePeak,
      byType: Object.fromEntries(realtimeTypes),
    },
    hermes: {
      supported: heap.samples > 0,
      samples: heap.samples,
      heapBytesFirst: heap.first,
      heapBytesLast: heap.last,
      heapBytesMax: heap.max,
      gcCount: delta(heap.gcFirst, heap.gcLast),
      gcTimeMs: delta(heap.gcTimeFirst, heap.gcTimeLast),
    },
  };
}
