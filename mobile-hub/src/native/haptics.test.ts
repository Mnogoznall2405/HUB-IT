import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import {
  assertPortalHapticPayload,
  performPortalHaptic,
} from './haptics';

jest.mock('expo-haptics', () => ({
  AndroidHaptics: {
    Confirm: 'confirm',
    Reject: 'reject',
    Segment_Tick: 'segment-tick',
  },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  performAndroidHapticsAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));

describe('portal haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  });

  it('accepts only one allowlisted kind', () => {
    expect(assertPortalHapticPayload({ kind: 'selection' })).toBe('selection');
    expect(() => assertPortalHapticPayload({ kind: 'warning' })).toThrow('Unsupported haptic kind');
    expect(() => assertPortalHapticPayload({ kind: 'success', duration: 1000 })).toThrow('Invalid haptic payload');
  });

  it.each([
    ['selection', 'segment-tick'],
    ['success', 'confirm'],
    ['error', 'reject'],
  ] as const)('maps %s to a bounded Android haptic', async (kind, androidHaptic) => {
    await expect(performPortalHaptic({ kind })).resolves.toEqual({ kind });
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith(androidHaptic);
  });
});
