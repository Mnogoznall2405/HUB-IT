import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export const PORTAL_HAPTIC_KINDS = ['selection', 'success', 'error'] as const;
export type PortalHapticKind = (typeof PORTAL_HAPTIC_KINDS)[number];

export async function hapticSuccess(): Promise<void> {
  try {
    if (Platform.OS === 'android') await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics are optional and must never change the action result.
  }
}

export async function hapticError(): Promise<void> {
  try {
    if (Platform.OS === 'android') await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Haptics are optional and must never change the action result.
  }
}

export async function hapticSelection(): Promise<void> {
  try {
    if (Platform.OS === 'android') await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick);
    else await Haptics.selectionAsync();
  } catch {
    // Haptics are optional and must never change the action result.
  }
}

export function assertPortalHapticPayload(payload: Record<string, unknown>): PortalHapticKind {
  if (Object.keys(payload).length !== 1 || typeof payload.kind !== 'string') {
    throw new Error('Invalid haptic payload');
  }
  if (!PORTAL_HAPTIC_KINDS.includes(payload.kind as PortalHapticKind)) {
    throw new Error('Unsupported haptic kind');
  }
  return payload.kind as PortalHapticKind;
}

export async function performPortalHaptic(payload: Record<string, unknown>): Promise<{ kind: PortalHapticKind }> {
  const kind = assertPortalHapticPayload(payload);
  if (kind === 'success') await hapticSuccess();
  else if (kind === 'error') await hapticError();
  else await hapticSelection();
  return { kind };
}
