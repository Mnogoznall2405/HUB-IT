// UI responsiveness instrumentation: conversation-open path, inbox readiness
// and a JS event-loop stall probe. In-memory, bounded, numbers and fixed enums
// only — never identifiers, titles or message content.
import { AppState, Platform } from 'react-native';
import { getApiInflightSummary } from './apiInflight';
import { resetScreenLoadTrace } from './screenSettle';
import { getUiOpenSummary, resetUiOpenTiming, type UiOpenStats } from './uiOpenTiming';
import {
  getPerfSummary, noteStallCulprit, overlappingWork, resetPerfProbes, startPerfSampler, stopPerfSampler, type PerfSummary,
} from './perfProbes';
import type { ChatTimingStats } from './chatSendTiming';

export type ThreadOpenSource = 'list' | 'search' | 'create' | 'other';

export type UiTimingSummary = {
  /** TEMPORARY: time-to-visible per screen/sheet/panel (see uiOpenTiming.ts). */
  opens: Record<string, UiOpenStats>;
  /** TEMPORARY: request/render/realtime/heap probes (see perfProbes.ts). */
  perf: PerfSummary;
  threadOpens: {
    count: number;
    fromCache: number;
    sources: Record<ThreadOpenSource, number>;
    intervals: {
      tap_to_mount: ChatTimingStats;
      tap_to_ready: ChatTimingStats;
      mount_to_ready: ChatTimingStats;
    };
  };
  inbox: {
    loads: number;
    fromCache: number;
    intervals: {
      to_first_items: ChatTimingStats;
      to_live: ChatTimingStats;
    };
  };
  loopLag: {
    sampledSeconds: number;
    stalls150: number;
    stalls500: number;
    stalls1500: number;
    maxLagMs: number;
    /** Stalls >=150 ms per screen area (fixed route-template names). */
    byArea: Record<string, { stalls150: number; stalls500: number; maxLagMs: number }>;
    /** Worst individual stalls with what was going on at that moment. */
    worst: Array<{
      at: string;
      lagMs: number;
      area: string;
      apiInflight: number;
      videoStickers: number;
      threadMessages: number;
      /** Own work that overlapped the stall, biggest first. */
      overlap: Array<{ name: string; ms: number }>;
    }>;
  };
};

const MAX_SAMPLES = 32;
// A tap older than this can no longer be paired with a screen mount: the user
// obviously gave up or the navigation was cancelled.
const STALE_TRACE_MS = 60_000;
const LOOP_TICK_MS = 400;
const MAX_AREAS = 16;
const MAX_WORST_STALLS = 8;
const STALL_MIN_MS = 150;

type ThreadOpenTrace = {
  tapAt: number;
  source: ThreadOpenSource;
  mountedAt?: number;
  readyAt?: number;
  cached?: boolean;
};
type ThreadOpenSample = {
  tapToMountMs: number | null;
  tapToReadyMs: number;
  mountToReadyMs: number | null;
  cached: boolean;
  source: ThreadOpenSource;
};
type InboxTrace = { startedAt: number; firstItemsAt?: number };
type InboxSample = { toFirstItemsMs: number; toLiveMs: number; cached: boolean };

let pendingThread: ThreadOpenTrace | null = null;
const threadSamples: ThreadOpenSample[] = [];
let pendingInbox: InboxTrace | null = null;
const inboxSamples: InboxSample[] = [];
const loopLag = { sampledMs: 0, stalls150: 0, stalls500: 0, stalls1500: 0, maxLagMs: 0 };
const loopLagByArea = new Map<string, { stalls150: number; stalls500: number; maxLagMs: number }>();
const worstStalls: UiTimingSummary['loopLag']['worst'] = [];
let currentArea = 'other';
let liveVideoStickerCount = 0;
let threadMessageCount = 0;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let loopLastTickAt = 0;
let loopAppStateSubscription: { remove(): void } | null = null;

function freshPendingThread(now: number): ThreadOpenTrace | null {
  if (!pendingThread) return null;
  if (now - pendingThread.tapAt > STALE_TRACE_MS) {
    pendingThread = null;
    return null;
  }
  return pendingThread;
}

function pushBounded<T>(list: T[], item: T): void {
  list.push(item);
  while (list.length > MAX_SAMPLES) list.shift();
}

function finishThreadOpen(trace: ThreadOpenTrace): void {
  pendingThread = null;
  pushBounded(threadSamples, {
    tapToMountMs: trace.mountedAt !== undefined ? trace.mountedAt - trace.tapAt : null,
    tapToReadyMs: (trace.readyAt ?? trace.tapAt) - trace.tapAt,
    mountToReadyMs:
      trace.mountedAt !== undefined && trace.readyAt !== undefined
        ? trace.readyAt - trace.mountedAt
        : null,
    cached: Boolean(trace.cached),
    source: trace.source,
  });
}

export function noteThreadOpenTap(source: ThreadOpenSource = 'other', at: number = Date.now()): void {
  pendingThread = { tapAt: at, source };
}

export function noteThreadMounted(at: number = Date.now()): void {
  const trace = freshPendingThread(at);
  if (!trace || trace.mountedAt !== undefined) return;
  trace.mountedAt = at;
}

function noteThreadReady(cached: boolean, at: number): void {
  const trace = freshPendingThread(at);
  if (!trace || trace.readyAt !== undefined) return;
  trace.readyAt = at;
  trace.cached = cached;
  finishThreadOpen(trace);
}

export function noteThreadCacheReady(at: number = Date.now()): void {
  noteThreadReady(true, at);
}

export function noteThreadLiveReady(at: number = Date.now()): void {
  noteThreadReady(false, at);
}

export function noteInboxLoadStart(at: number = Date.now()): void {
  pendingInbox = { startedAt: at };
}

export function noteInboxCacheReady(at: number = Date.now()): void {
  if (!pendingInbox || pendingInbox.firstItemsAt !== undefined) return;
  pendingInbox.firstItemsAt = at;
}

export function noteInboxLiveReady(at: number = Date.now()): void {
  const trace = pendingInbox;
  if (!trace) return;
  pendingInbox = null;
  pushBounded(inboxSamples, {
    toFirstItemsMs: (trace.firstItemsAt ?? at) - trace.startedAt,
    toLiveMs: at - trace.startedAt,
    cached: trace.firstItemsAt !== undefined,
  });
}

/** Screen the user is on, as a fixed route-template name (never ids or params). */
export function setUiArea(area: string): void {
  currentArea = /^[a-z][a-z-]{0,23}$/.test(area) ? area : 'other';
}

/** Messages loaded in the open thread (0 when none) — list size drives render cost. */
export function noteThreadMessageCount(count: number): void {
  threadMessageCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

/** Native sticker players alive right now — a suspect for thread stalls. */
export function noteLiveVideoStickers(count: number): void {
  liveVideoStickerCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

// One probe tick = one observed interval deadline while the app is foregrounded.
// The lag argument is how late the tick ran — that is the JS-thread stall the
// user feels as frozen taps and delayed transitions.
export function noteLoopLag(lagMs: number, tickMs: number = LOOP_TICK_MS): void {
  if (!Number.isFinite(lagMs) || !Number.isFinite(tickMs)) return;
  loopLag.sampledMs += Math.max(0, Math.trunc(tickMs));
  if (lagMs <= 0) return;
  const lag = Math.trunc(lagMs);
  if (lag > loopLag.maxLagMs) loopLag.maxLagMs = lag;
  if (lag >= 1500) loopLag.stalls1500 += 1;
  else if (lag >= 500) loopLag.stalls500 += 1;
  else if (lag >= STALL_MIN_MS) loopLag.stalls150 += 1;
  if (lag < STALL_MIN_MS) return;
  const area = currentArea;
  const stallEnd = Date.now();
  const stallStart = stallEnd - lag - tickMs;
  noteStallCulprit(stallStart, stallEnd);
  const bucket = loopLagByArea.get(area)
    ?? (loopLagByArea.size < MAX_AREAS ? { stalls150: 0, stalls500: 0, maxLagMs: 0 } : null);
  if (bucket) {
    bucket.stalls150 += 1;
    if (lag >= 500) bucket.stalls500 += 1;
    if (lag > bucket.maxLagMs) bucket.maxLagMs = lag;
    loopLagByArea.set(area, bucket);
  }
  const smallest = worstStalls.length >= MAX_WORST_STALLS
    ? worstStalls.reduce((min, item) => (item.lagMs < min.lagMs ? item : min), worstStalls[0])
    : null;
  if (!smallest || lag > smallest.lagMs) {
    if (smallest) worstStalls.splice(worstStalls.indexOf(smallest), 1);
    worstStalls.push({
      at: new Date().toISOString(),
      lagMs: lag,
      area,
      apiInflight: getApiInflightSummary().current,
      videoStickers: liveVideoStickerCount,
      threadMessages: threadMessageCount,
      overlap: overlappingWork(stallStart, stallEnd),
    });
  }
}

export function startLoopLagProbe(): void {
  if (loopTimer || Platform.OS === 'web') return;
  startPerfSampler();
  const arm = () => { loopLastTickAt = Date.now(); };
  arm();
  // Background time is excluded: timers may be throttled there and the pause
  // would otherwise masquerade as the longest possible stall.
  loopAppStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') arm();
  });
  loopTimer = setInterval(() => {
    if (AppState.currentState !== 'active') {
      arm();
      return;
    }
    const now = Date.now();
    const lag = now - loopLastTickAt - LOOP_TICK_MS;
    loopLastTickAt = now;
    noteLoopLag(lag);
  }, LOOP_TICK_MS);
}

export function stopLoopLagProbe(): void {
  stopPerfSampler();
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  loopAppStateSubscription?.remove();
  loopAppStateSubscription = null;
}

export function resetUiTiming(): void {
  resetUiOpenTiming();
  resetScreenLoadTrace();
  resetPerfProbes();
  pendingThread = null;
  threadSamples.length = 0;
  pendingInbox = null;
  inboxSamples.length = 0;
  loopLag.sampledMs = 0;
  loopLag.stalls150 = 0;
  loopLag.stalls500 = 0;
  loopLag.stalls1500 = 0;
  loopLag.maxLagMs = 0;
  loopLagByArea.clear();
  worstStalls.length = 0;
  currentArea = 'other';
  liveVideoStickerCount = 0;
  threadMessageCount = 0;
}

function stats(values: number[]): ChatTimingStats {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  const pick = (p: number) => (sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null);
  return { count: sorted.length, p50: pick(0.5), p95: pick(0.95) };
}

export function getUiTimingSummary(): UiTimingSummary {
  return {
    opens: getUiOpenSummary(),
    perf: getPerfSummary(),
    threadOpens: {
      count: threadSamples.length,
      fromCache: threadSamples.filter((sample) => sample.cached).length,
      sources: {
        list: threadSamples.filter((sample) => sample.source === 'list').length,
        search: threadSamples.filter((sample) => sample.source === 'search').length,
        create: threadSamples.filter((sample) => sample.source === 'create').length,
        other: threadSamples.filter((sample) => sample.source === 'other').length,
      },
      intervals: {
        tap_to_mount: stats(threadSamples.map((sample) => sample.tapToMountMs).filter((v): v is number => v !== null)),
        tap_to_ready: stats(threadSamples.map((sample) => sample.tapToReadyMs)),
        mount_to_ready: stats(threadSamples.map((sample) => sample.mountToReadyMs).filter((v): v is number => v !== null)),
      },
    },
    inbox: {
      loads: inboxSamples.length,
      fromCache: inboxSamples.filter((sample) => sample.cached).length,
      intervals: {
        to_first_items: stats(inboxSamples.map((sample) => sample.toFirstItemsMs)),
        to_live: stats(inboxSamples.map((sample) => sample.toLiveMs)),
      },
    },
    loopLag: {
      sampledSeconds: Math.round(loopLag.sampledMs / 1000),
      stalls150: loopLag.stalls150,
      stalls500: loopLag.stalls500,
      stalls1500: loopLag.stalls1500,
      maxLagMs: loopLag.maxLagMs,
      byArea: Object.fromEntries(loopLagByArea),
      worst: worstStalls.slice().sort((a, b) => b.lagMs - a.lagMs),
    },
  };
}
