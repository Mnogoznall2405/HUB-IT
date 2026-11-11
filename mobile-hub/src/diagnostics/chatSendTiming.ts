// In-memory send-path instrumentation for the native chat baseline (plan B1).
// Cheap in release by design: bounded Maps, no I/O, numbers only — never text,
// identifiers or message content.
export type ChatSendMark =
  | 'tap_send'
  | 'bubble_visible'
  | 'outbox_persisted'
  | 'http_start'
  | 'http_ack'
  | 'ui_confirmed';
export type ChatQueueStorageOp = 'read' | 'write' | 'delete';
export type ChatTimingStats = { count: number; p50: number | null; p95: number | null };
export type ChatSendTimingSummary = {
  sends: number;
  intervals: Record<
    'tap_to_bubble' | 'tap_to_outbox_persisted' | 'tap_to_http_start' | 'tap_to_ack' | 'tap_to_ui_confirmed',
    ChatTimingStats
  >;
  storageOps: Record<ChatQueueStorageOp, ChatTimingStats & { bytesP95: number | null }>;
};

const MAX_TRACES = 32;
const MAX_STORAGE_SAMPLES = 240;
const SEND_MARKS = new Set<ChatSendMark>([
  'tap_send', 'bubble_visible', 'outbox_persisted', 'http_start', 'http_ack', 'ui_confirmed',
]);
const traces = new Map<string, Partial<Record<ChatSendMark, number>>>();
const storageSamples: { op: ChatQueueStorageOp; ms: number; bytes: number }[] = [];
// Sends that reached http_start but not a terminal mark: used by the header to
// flag a stalled connection even while the socket still claims to be alive.
const pendingSendStarts = new Map<string, number>();
const STALLED_SEND_THRESHOLD_MS = 5_000;

export function markChatSend(traceId: string, mark: ChatSendMark, at: number = Date.now()): void {
  if (!SEND_MARKS.has(mark) || !traceId || !Number.isFinite(at)) return;
  // A repeated tap_send means a manual retry of the same client id: the stale
  // trace must not mix its earlier attempt timings into the new send.
  if (mark === 'tap_send') {
    traces.delete(traceId);
    pendingSendStarts.delete(traceId);
  }
  if (mark === 'http_start') pendingSendStarts.set(traceId, at);
  if (mark === 'http_ack' || mark === 'ui_confirmed') pendingSendStarts.delete(traceId);
  const trace = traces.get(traceId) || {};
  trace[mark] = at;
  traces.delete(traceId);
  traces.set(traceId, trace);
  while (traces.size > MAX_TRACES) {
    const evicted = traces.keys().next().value!;
    traces.delete(evicted);
    pendingSendStarts.delete(evicted);
  }
}

// Terminal outcome without an ack mark (send failed, cancelled or paused):
// drops the trace from the pending set so the header stops flagging a stall.
export function settleChatSend(traceId: string): void {
  pendingSendStarts.delete(traceId);
}

export function countStalledChatSends(now = Date.now(), thresholdMs = STALLED_SEND_THRESHOLD_MS): number {
  let count = 0;
  pendingSendStarts.forEach((started) => {
    if (now - started >= thresholdMs) count += 1;
  });
  return count;
}

export function recordChatQueueStorageOp(op: ChatQueueStorageOp, durationMs: number, bytes: number): void {
  if (!['read', 'write', 'delete'].includes(op) || !Number.isFinite(durationMs) || !Number.isFinite(bytes)) return;
  storageSamples.push({ op, ms: Math.max(0, durationMs), bytes: Math.max(0, Math.trunc(bytes)) });
  while (storageSamples.length > MAX_STORAGE_SAMPLES) storageSamples.shift();
}

export function resetChatSendTiming(): void {
  traces.clear();
  pendingSendStarts.clear();
  storageSamples.length = 0;
}

function stats(values: number[]): ChatTimingStats {
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (p: number) => (sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null);
  return { count: sorted.length, p50: pick(0.5), p95: pick(0.95) };
}

export function getChatSendTimingSummary(): ChatSendTimingSummary {
  const intervalDefs: Record<keyof ChatSendTimingSummary['intervals'], [ChatSendMark, ChatSendMark]> = {
    tap_to_bubble: ['tap_send', 'bubble_visible'],
    tap_to_outbox_persisted: ['tap_send', 'outbox_persisted'],
    tap_to_http_start: ['tap_send', 'http_start'],
    tap_to_ack: ['tap_send', 'http_ack'],
    tap_to_ui_confirmed: ['tap_send', 'ui_confirmed'],
  };
  const intervals = {} as ChatSendTimingSummary['intervals'];
  for (const [name, [from, to]] of Object.entries(intervalDefs)) {
    const deltas: number[] = [];
    traces.forEach((trace) => {
      const start = trace[from], end = trace[to];
      if (start !== undefined && end !== undefined && end >= start) deltas.push(end - start);
    });
    intervals[name as keyof ChatSendTimingSummary['intervals']] = stats(deltas);
  }
  const storageOps = {} as ChatSendTimingSummary['storageOps'];
  for (const op of ['read', 'write', 'delete'] as const) {
    const rows = storageSamples.filter((sample) => sample.op === op);
    storageOps[op] = { ...stats(rows.map((row) => row.ms)), bytesP95: stats(rows.map((row) => row.bytes)).p95 };
  }
  return { sends: traces.size, intervals, storageOps };
}
