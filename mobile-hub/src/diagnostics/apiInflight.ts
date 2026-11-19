// In-flight axios request counter for the send-priority check (plan S11).
// Numbers only — never URLs, params, headers or payloads.
import type { ChatTimingStats } from './chatSendTiming';
import { noteScreenLoadActivity } from './screenSettle';

const MAX_INFLIGHT_SAMPLES = 120;

export type ApiInflightSummary = {
  current: number;
  maxObserved: number;
  started: number;
  completed: number;
  atChatSendHttpStart: ChatTimingStats;
};

let inFlight = 0;
let maxObserved = 0;
let startedTotal = 0;
let completedTotal = 0;
// A completion is booked only for a start seen in the current epoch: response
// interceptor errors for requests rejected before dispatch carry no tracked
// config, and late results after a reset must not pollute the new epoch.
let epoch = 0;
const requestEpochs = new WeakMap<object, number>();
const sendStartSamples: number[] = [];

export function noteApiRequestStart(config: object): void {
  requestEpochs.set(config, epoch);
  inFlight += 1;
  startedTotal += 1;
  if (inFlight > maxObserved) maxObserved = inFlight;
  noteScreenLoadActivity();
}

export function noteApiRequestEnd(config: object | undefined): void {
  if (!config || requestEpochs.get(config) !== epoch) return;
  requestEpochs.delete(config);
  inFlight -= 1;
  completedTotal += 1;
  noteScreenLoadActivity();
}

// Samples the background request pressure a chat send has to compete with:
// called right before the send's own request starts, so it counts only others.
export function noteChatSendHttpStartInflight(): void {
  sendStartSamples.push(inFlight);
  while (sendStartSamples.length > MAX_INFLIGHT_SAMPLES) sendStartSamples.shift();
}

export function resetApiInflight(): void {
  epoch += 1;
  inFlight = 0;
  maxObserved = 0;
  startedTotal = 0;
  completedTotal = 0;
  sendStartSamples.length = 0;
}

export function getApiInflightSummary(): ApiInflightSummary {
  const sorted = sendStartSamples.slice().sort((a, b) => a - b);
  const pick = (p: number) => (sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null);
  return {
    current: inFlight,
    maxObserved,
    started: startedTotal,
    completed: completedTotal,
    atChatSendHttpStart: { count: sorted.length, p50: pick(0.5), p95: pick(0.95) },
  };
}
