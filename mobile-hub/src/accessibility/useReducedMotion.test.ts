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
