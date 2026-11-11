import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { NativeModal } from './NativeModal';

afterEach(() => jest.restoreAllMocks());
it('updates modal motion live and preserves its close action and content', async () => {
  let changed!: (enabled: boolean) => void;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_, listener) => {
    changed = listener as unknown as (value: boolean) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });
  const onClose = jest.fn();
  const view = await render(<NativeModal testID="motion-modal" visible animationType="slide" onRequestClose={onClose}><Text>Форма</Text></NativeModal>);
  expect(view.getByTestId('motion-modal').props.animationType).toBe('slide');
  await act(async () => changed(true));
  expect(view.getByTestId('motion-modal').props.animationType).toBe('none');
  expect(view.getByText('Форма')).toBeTruthy();
  await act(async () => view.getByTestId('motion-modal').props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => changed(false));
  expect(view.getByTestId('motion-modal').props.animationType).toBe('slide');
});
