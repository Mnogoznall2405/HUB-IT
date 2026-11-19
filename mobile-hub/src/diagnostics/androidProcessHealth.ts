import { Platform } from 'react-native';
import HubitDeviceHealthModule, {
  type HubitAndroidProcessExitResult,
} from '../../modules/hubit-device-health';

const MAX_EXIT_RECORDS = 20;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const EXIT_REASONS = [
  'anr',
  'crash',
  'native_crash',
  'low_memory',
  'excessive_resource',
  'initialization_failure',
  'dependency_died',
  'permission_change',
  'user_requested',
  'user_stopped',
  'exit_self',
  'signaled',
  'freezer',
  'package_state_change',
  'package_updated',
  'other',
] as const;

export type AndroidProcessExitReason = (typeof EXIT_REASONS)[number];

export type AndroidProcessExitEntry = {
  at: string;
  reason: AndroidProcessExitReason;
};

export type AndroidExitCounts = {
  anr: number;
  crash: number;
  nativeCrash: number;
  lowMemory: number;
  excessiveResource: number;
  otherUnexpected: number;
  expected: number;
};

export type AndroidProcessHealthSnapshot = {
  schemaVersion: 2;
  status: 'available' | 'unsupported' | 'unavailable';
  minAndroidApi: 30;
  historyLimit: 20;
  latestAt: string | null;
  counts: AndroidExitCounts;
  // Exits observed after the running build was first seen by this app. This is
  // an observation window over timestamps, not proof that a particular exit
  // belongs to this APK version; null when no honest boundary exists.
  sinceCurrentBuildFirstSeen: {
    at: string;
    counts: AndroidExitCounts;
  } | null;
  recent: AndroidProcessExitEntry[];
};

const reasonSet = new Set<string>(EXIT_REASONS);

function emptyExitCounts(): AndroidExitCounts {
  return {
    anr: 0,
    crash: 0,
    nativeCrash: 0,
    lowMemory: 0,
    excessiveResource: 0,
    otherUnexpected: 0,
    expected: 0,
  };
}

function emptySnapshot(
  status: AndroidProcessHealthSnapshot['status'],
): AndroidProcessHealthSnapshot {
  return {
    schemaVersion: 2,
    status,
    minAndroidApi: 30,
    historyLimit: 20,
    latestAt: null,
    counts: emptyExitCounts(),
    sinceCurrentBuildFirstSeen: null,
    recent: [],
  };
}

function countExits(entries: AndroidProcessExitEntry[]): AndroidExitCounts {
  const counts = emptyExitCounts();
  for (const entry of entries) {
    if (entry.reason === 'anr') counts.anr += 1;
    else if (entry.reason === 'crash') counts.crash += 1;
    else if (entry.reason === 'native_crash') counts.nativeCrash += 1;
    else if (entry.reason === 'low_memory') counts.lowMemory += 1;
    else if (entry.reason === 'excessive_resource') counts.excessiveResource += 1;
    else if ([
      'exit_self',
      'user_requested',
      'user_stopped',
      'permission_change',
      'freezer',
      'package_state_change',
      'package_updated',
    ].includes(entry.reason)) {
      counts.expected += 1;
    } else {
      counts.otherUnexpected += 1;
    }
  }
  return counts;
}

export function normalizeAndroidProcessHealth(
  raw: HubitAndroidProcessExitResult | null | undefined,
  now = Date.now(),
  currentBuildFirstSeenAt?: string | null,
): AndroidProcessHealthSnapshot {
  if (!raw?.supported) return emptySnapshot('unsupported');
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const seen = new Set<string>();
  const recent = entries
    .map((item) => {
      const timestampMs = Number(item?.timestampMs || 0);
      const rawReason = String(item?.reason || '').trim();
      if (
        !Number.isFinite(timestampMs)
        || timestampMs <= 0
        || timestampMs > now + FUTURE_CLOCK_SKEW_MS
      ) return null;
      const reason = reasonSet.has(rawReason)
        ? rawReason as AndroidProcessExitReason
        : 'other';
      const key = `${Math.trunc(timestampMs)}:${reason}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { at: new Date(timestampMs).toISOString(), reason };
    })
    .filter((item): item is AndroidProcessExitEntry => Boolean(item))
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, MAX_EXIT_RECORDS);

  const snapshot = emptySnapshot('available');
  snapshot.recent = recent;
  snapshot.latestAt = recent[0]?.at || null;
  snapshot.counts = countExits(recent);

  const boundaryMs = Number(currentBuildFirstSeenAt
    ? new Date(String(currentBuildFirstSeenAt)).getTime()
    : NaN);
  if (Number.isFinite(boundaryMs) && boundaryMs <= now) {
    const at = new Date(boundaryMs).toISOString();
    snapshot.sinceCurrentBuildFirstSeen = {
      at,
      counts: countExits(recent.filter((entry) => entry.at >= at)),
    };
  }
  return snapshot;
}

export async function getAndroidProcessHealthSnapshot(
  currentBuildFirstSeenAt?: string | null,
): Promise<AndroidProcessHealthSnapshot> {
  if (Platform.OS !== 'android' || !HubitDeviceHealthModule) return emptySnapshot('unavailable');
  try {
    return normalizeAndroidProcessHealth(
      await HubitDeviceHealthModule.getHistoricalProcessExitInfoAsync(),
      Date.now(),
      currentBuildFirstSeenAt,
    );
  } catch {
    return emptySnapshot('unavailable');
  }
}
