import { PanResponder } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { EdgeBackSwipeOverlay } from './EdgeBackSwipeOverlay';

afterEach(() => jest.restoreAllMocks());

it.each(['disabled', 'callback', 'unmount', 'terminated'] as const)('does not navigate from a stale %s gesture', async (mode) => {
  const spy = jest.spyOn(PanResponder, 'create');
  const back = jest.fn();
  const nextBack = jest.fn();
  const view = await render(<EdgeBackSwipeOverlay onBack={back} />);
  const responder = spy.mock.calls.at(-1)![0];
  const event = { nativeEvent: { locationX: 80 } } as never;
  const gesture = { dx: 100, dy: 0, x0: 0 } as never;
  await act(async () => { responder.onPanResponderGrant?.(event, gesture); responder.onPanResponderMove?.(event, gesture); });
  if (mode === 'disabled') await view.rerender(<EdgeBackSwipeOverlay enabled={false} onBack={back} />);
  if (mode === 'callback') await view.rerender(<EdgeBackSwipeOverlay onBack={nextBack} />);
  if (mode === 'unmount') await view.unmount();
  if (mode === 'terminated') await act(async () => { responder.onPanResponderTerminate?.(event, gesture); });
  await act(async () => { responder.onPanResponderRelease?.(event, gesture); });
  expect(back).not.toHaveBeenCalled();
  expect(nextBack).not.toHaveBeenCalled();
});

it('uses the touch origin and navigates once for a valid edge swipe', async () => {
  const spy = jest.spyOn(PanResponder, 'create');
  const back = jest.fn();
  await render(<EdgeBackSwipeOverlay onBack={back} />);
  const responder = spy.mock.calls.at(-1)![0];
  const event = { nativeEvent: { locationX: 80 } } as never;
  const gesture = { dx: 100, dy: 0, x0: 0, moveX: 100 } as never;
  expect(responder.onMoveShouldSetPanResponder?.(event, gesture)).toBe(true);
  await act(async () => {
    responder.onPanResponderGrant?.(event, gesture);
    responder.onPanResponderMove?.(event, gesture);
    responder.onPanResponderRelease?.(event, gesture);
    responder.onPanResponderRelease?.(event, gesture);
  });
  expect(back).toHaveBeenCalledTimes(1);
});
