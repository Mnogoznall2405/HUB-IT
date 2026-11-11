import type { ChatAttachment } from '../api/types';

export const DEFAULT_CHAT_QUICK_REACTION = '👍';
export const VOICE_MIME_TYPE = 'audio/mp4';
export const VOICE_FILE_EXTENSION = 'm4a';

export function isAudioChatAttachment(attachment?: ChatAttachment | null): boolean {
  if (!attachment) return false;
  const kind = String(attachment.media_kind || attachment.kind || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'image' || kind === 'video' || kind === 'sticker') return false;
  if (kind === 'audio') return true;
  if (String(attachment.mime_type || '').startsWith('audio/')) return true;
  return String(attachment.file_name || '').toLowerCase().startsWith('voice_');
}

export function formatVoiceDuration(seconds?: number | null): string {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function voiceFileName(now = Date.now()): string {
  return `voice_${now}.${VOICE_FILE_EXTENSION}`;
}

export function normalizeVoiceDurationSeconds(value?: number | null): number {
  const numeric = Math.round(Number(value || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.min(86400, numeric);
}

export const VOICE_PLAYBACK_BARS = 32;
export const VOICE_RECORDING_BARS = 18;
export const VOICE_RECORDING_BAR_PROFILE = [
  0.22, 0.52, 0.34, 0.78, 0.48, 0.92,
  0.58, 0.36, 0.72, 0.44, 0.84, 0.62,
  0.28, 0.68, 0.4, 0.76, 0.5, 0.3,
] as const;

export function clampVoiceLevel(value?: number | null): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function meteringToVoiceLevel(metering?: number | null): number {
  if (metering == null || !Number.isFinite(Number(metering))) return 0;
  return clampVoiceLevel((Number(metering) + 50) / 50);
}

export function fallbackVoiceRecordingLevel(nowMs: number): number {
  return 0.22 + 0.28 * (0.5 + 0.5 * Math.sin(nowMs / 180));
}

export function resolveVoiceRecordingLevel(metering?: number | null, nowMs = Date.now()): number {
  if (metering == null || !Number.isFinite(Number(metering))) {
    return fallbackVoiceRecordingLevel(nowMs);
  }
  return meteringToVoiceLevel(metering);
}

export function hashVoiceSeed(seed: string): number {
  let hash = 2166136261;
  const text = String(seed || 'voice');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildVoiceWaveform(seed: string, bars = VOICE_PLAYBACK_BARS): number[] {
  const count = Math.max(1, Math.round(Number(bars) || VOICE_PLAYBACK_BARS));
  let value = hashVoiceSeed(seed) || 1;
  return Array.from({ length: count }, () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return 0.18 + (value / 0xffffffff) * 0.82;
  });
}

export function voicePlaybackProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  return Math.max(0, Math.min(1, currentTime / duration));
}

export function isVoiceWaveformBarFilled(
  progress: number,
  index: number,
  bars = VOICE_PLAYBACK_BARS,
): boolean {
  return index < clampVoiceLevel(progress) * Math.max(1, bars);
}

export function voiceSeekRatio(locationX: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(0, Math.min(1, locationX / width));
}

export function recordingBarHeightPx(
  level: number,
  profile: number,
  options: { compact?: boolean } = {},
): number {
  const compact = Boolean(options.compact);
  const quietHeight = 3 + profile * 3.8;
  const activeHeight = compact ? 22 : 24;
  const maxHeight = compact ? 24 : 26;
  return Math.min(
    maxHeight,
    quietHeight + clampVoiceLevel(level) * activeHeight * (0.42 + profile),
  );
}

let voiceSurfaceLocks = 0;

export function lockChatVoiceSurface() {
  voiceSurfaceLocks += 1;
}

export function unlockChatVoiceSurface() {
  voiceSurfaceLocks = Math.max(0, voiceSurfaceLocks - 1);
}

export function isChatVoiceSurfaceLocked() {
  return voiceSurfaceLocks > 0;
}

export const CHAT_DOUBLE_TAP_WINDOW_MS = 280;
export const CHAT_BUBBLE_LONG_PRESS_MS = 220;

export function shouldTreatAsDoubleTap(
  previousTapAt: number,
  now: number,
  windowMs = CHAT_DOUBLE_TAP_WINDOW_MS,
): boolean {
  return previousTapAt > 0 && now - previousTapAt <= windowMs;
}

export function resolveChatBubbleTapAction(options: {
  selected?: boolean;
  hasQuickReaction?: boolean;
  previousTapAt: number;
  now: number;
}): 'menu' | 'quick-reaction' {
  if (!options.selected && options.hasQuickReaction && shouldTreatAsDoubleTap(options.previousTapAt, options.now)) {
    return 'quick-reaction';
  }
  return 'menu';
}

export const VOICE_HOLD_CANCEL_START_DP = 24;
export const VOICE_HOLD_CANCEL_TRIGGER_DP = 72;
export const VOICE_HOLD_LOCK_TRIGGER_DP = 56;
export const VOICE_HOLD_TAP_LOCK_MS = 220;
export const VOICE_HOLD_MIN_SEND_MS = 500;

export type VoiceHoldGesture = 'record' | 'cancel' | 'lock';
export type VoiceHoldReleaseAction = 'send' | 'cancel' | 'lock';

export function resolveVoiceHoldGesture(dx: number, dy: number): VoiceHoldGesture {
  if (dy <= -VOICE_HOLD_LOCK_TRIGGER_DP && Math.abs(dy) >= Math.abs(dx)) return 'lock';
  if (dx <= -VOICE_HOLD_CANCEL_TRIGGER_DP && Math.abs(dx) >= Math.abs(dy)) return 'cancel';
  return 'record';
}

export function shouldHintVoiceCancel(dx: number): boolean {
  return dx <= -VOICE_HOLD_CANCEL_START_DP;
}

export function resolveVoiceMicRelease(options: {
  heldMs: number;
  dx: number;
  dy: number;
}): VoiceHoldReleaseAction {
  const gesture = resolveVoiceHoldGesture(options.dx, options.dy);
  if (gesture === 'cancel') return 'cancel';
  if (gesture === 'lock') return 'lock';
  if (options.heldMs < VOICE_HOLD_TAP_LOCK_MS) return 'lock';
  if (options.heldMs < VOICE_HOLD_MIN_SEND_MS) return 'cancel';
  return 'send';
}

export function voiceHoldHintLabel(hint: VoiceHoldGesture): string {
  if (hint === 'cancel') return 'Отпустите, чтобы отменить';
  if (hint === 'lock') return 'Отпустите, чтобы закрепить';
  return '← Отмена  ·  ↑ Удержать';
}
