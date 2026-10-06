// TEMPORARY performance instrumentation: how long a screen keeps loading data after
// the user navigates to it. Needs no per-screen wiring: a trace starts on every
// route change and ends once the API goes quiet; the duration is the time until the
// last request of that burst finished (recorded as `load:<screen>` in `opens`).
// Fixed screen names and numbers only. Remove with uiOpenTiming.ts when the app is fast.
import { getApiInflightSummary } from './apiInflight';
import { noteUiOpen } from './uiOpenTiming';

const POLL_MS = 150;
const QUIET_MS = 400;
const NO_REQUEST_GIVE_UP_MS = 1_500;
const MAX_TRACE_MS = 30_000;

type Trace = {
  name: string;
  startedAt: number;
  requested: boolean;
  lastActivityAt: number;
  timer: ReturnType<typeof setInterval>;
};

let trace: Trace | null = null;

function finish(record: boolean): void {
  if (!trace) return;
  clearInterval(trace.timer);
  if (record && trace.requested) noteUiOpen(trace.name, trace.lastActivityAt - trace.startedAt);
  trace = null;
}

function check(): void {
  if (!trace) return;
  const now = Date.now();
  if (now - trace.startedAt > MAX_TRACE_MS) {
    finish(false);
    return;
  }
  if (!trace.requested) {
    // Served entirely from cache: nothing was loading.
    if (now - trace.startedAt >= NO_REQUEST_GIVE_UP_MS) finish(false);
    return;
  }
  if (getApiInflightSummary().current === 0 && now - trace.lastActivityAt >= QUIET_MS) finish(true);
}

export function beginScreenLoadTrace(screen: string, now: number = Date.now()): void {
  finish(false);
  const name = `load:${screen}`.slice(0, 32);
  trace = { name, startedAt: now, requested: false, lastActivityAt: now, timer: setInterval(check, POLL_MS) };
}

/** Called for every API request start/end (from apiInflight). */
export function noteScreenLoadActivity(now: number = Date.now()): void {
  if (!trace) return;
  trace.requested = true;
  trace.lastActivityAt = now;
}

export function resetScreenLoadTrace(): void {
  finish(false);
}
