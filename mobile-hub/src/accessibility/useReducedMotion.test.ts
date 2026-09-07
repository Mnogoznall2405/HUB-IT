import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

afterEach(() => {
  jest.restoreAllMocks();
});

it('follows the Android reduced-motion preference and removes its listener', async () => {
  let onChange: ((enabled: boolean) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((...args: unknown[]) => {
    expect(args[0]).toBe('reduceMotionChanged');
    onChange = args[1] as (enabled: boolean) => void;
    return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });

  const { result, unmount } = await renderHook(() => useReducedMotion());
  await act(async () => undefined);
  expect(result.current).toBe(true);

  await act(async () => onChange?.(false));
  expect(result.current).toBe(false);
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('does not let a late initial read override a newer system event', async () => {
  let resolve!: (value: boolean) => void;
  let changed!: (value: boolean) => void;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise((done) => { resolve = done; }));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, listener) => {
    changed = listener as unknown as (value: boolean) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });
  const view = await renderHook(() => useReducedMotion());
  expect(view.result.current).toBe(true);
  await act(async () => changed(true));
  await act(async () => resolve(false));
  expect(view.result.current).toBe(true);
  await act(async () => changed(false));
  expect(view.result.current).toBe(false);
});

it('keeps motion disabled if the initial preference read fails', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('synthetic platform failure'));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  const view = await renderHook(() => useReducedMotion());
  expect(view.result.current).toBe(true);
});
