// On-device chat event journal for manual device checks (plan item "проверка на
// устройстве"). Entries land in the shareable diagnostics report, so the person
// running the check can send one JSON file back instead of describing what
// happened. Privacy contract: event names are fixed tokens, field values are
// numbers, booleans or short enum-like tokens — never message text, titles,
// names or identifiers (anything that does not look like a token is dropped).
import { File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';

export type ChatDeviceLogValue = number | boolean | string | null;
export type ChatDeviceLogFields = Record<string, ChatDeviceLogValue>;
export type ChatDeviceLogEntry = {
  /** ISO time of the event. */
  t: string;
  /** Per-process session marker, to tell app launches apart. */
  s: string;
  /** Event name, e.g. `sheet_open`. */
  e: string;
  f?: ChatDeviceLogFields;
};

const MAX_ENTRIES = 400;
const MAX_FIELDS = 8;
const FLUSH_DELAY_MS = 2_000;
const FILE_NAME = 'hubit-chat-device-log.json';
const EVENT_NAME = /^[a-z][a-z0-9_.]{1,39}$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,23}$/;
const TOKEN_VALUE = /^[a-zA-Z0-9_.:+-]{1,32}$/;

const sessionId = Math.random().toString(36).slice(2, 8);
let entries: ChatDeviceLogEntry[] = [];
let priorEntries: ChatDeviceLogEntry[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();
let appStateHooked = false;

function logFile(): File | null {
  try {
    const directory = (Paths as { document?: unknown }).document;
    if (!directory) return null;
    return new File(directory as never, FILE_NAME);
  } catch {
    return null;
  }
}

function sanitizeFields(fields?: ChatDeviceLogFields): ChatDeviceLogFields | undefined {
  if (!fields) return undefined;
  const clean: ChatDeviceLogFields = {};
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (count >= MAX_FIELDS) break;
    if (!FIELD_NAME.test(key)) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      clean[key] = Math.round(value * 10) / 10;
    } else if (typeof value === 'boolean' || value === null) {
      clean[key] = value;
    } else if (typeof value === 'string' && TOKEN_VALUE.test(value)) {
      clean[key] = value;
    } else {
      continue;
    }
    count += 1;
  }
  return count ? clean : undefined;
}

function normalizeStored(value: unknown): ChatDeviceLogEntry[] {
  const list = (value as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) return [];
  const result: ChatDeviceLogEntry[] = [];
  for (const raw of list) {
    const item = raw as Partial<ChatDeviceLogEntry> | null;
    if (!item || typeof item.e !== 'string' || !EVENT_NAME.test(item.e)) continue;
    if (typeof item.t !== 'string' || Number.isNaN(new Date(item.t).getTime())) continue;
    const entry: ChatDeviceLogEntry = {
      t: item.t,
      s: typeof item.s === 'string' && TOKEN_VALUE.test(item.s) ? item.s : '-',
      e: item.e,
    };
    const fields = sanitizeFields(item.f);
    if (fields) entry.f = fields;
    result.push(entry);
  }
  return result.slice(-MAX_ENTRIES);
}

async function loadPrior(): Promise<ChatDeviceLogEntry[]> {
  if (priorEntries) return priorEntries;
  try {
    const file = logFile();
    priorEntries = file && file.exists ? normalizeStored(JSON.parse(await file.text())) : [];
  } catch {
    priorEntries = [];
  }
  return priorEntries;
}

function hookAppState(): void {
  if (appStateHooked) return;
  appStateHooked = true;
  try {
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushChatDeviceLog();
    });
  } catch {
    // The journal is best effort; a missing AppState must never break the chat.
  }
}

export function logChatDevice(event: string, fields?: ChatDeviceLogFields): void {
  try {
    if (!EVENT_NAME.test(event)) return;
    hookAppState();
    const entry: ChatDeviceLogEntry = { t: new Date().toISOString(), s: sessionId, e: event };
    const clean = sanitizeFields(fields);
    if (clean) entry.f = clean;
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushChatDeviceLog();
      }, FLUSH_DELAY_MS);
      // Jest/node only: do not keep the worker alive for a best-effort flush.
      (flushTimer as { unref?: () => void }).unref?.();
    }
  } catch {
    // never throw from instrumentation
  }
}

/** Entries of earlier launches followed by the current one, oldest first. */
export async function readChatDeviceLog(): Promise<ChatDeviceLogEntry[]> {
  const prior = await loadPrior();
  return [...prior, ...entries].slice(-MAX_ENTRIES);
}

/** Synchronous view of the current launch only (used by the sync report builder). */
export function getChatDeviceLogSnapshot(): ChatDeviceLogEntry[] {
  return entries.slice();
}

export function flushChatDeviceLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushChain = flushChain.catch(() => undefined).then(async () => {
    const file = logFile();
    if (!file) return;
    const merged = [...(await loadPrior()), ...entries].slice(-MAX_ENTRIES);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify({ v: 1, entries: merged }));
  }).catch(() => undefined);
  return flushChain;
}

export async function resetChatDeviceLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  entries = [];
  priorEntries = [];
  await flushChain.catch(() => undefined);
  try {
    const file = logFile();
    if (file && file.exists) file.delete();
  } catch {
    // ignore
  }
}
