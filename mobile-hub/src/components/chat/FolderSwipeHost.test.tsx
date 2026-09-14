import { act, render } from '@testing-library/react-native';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState, View } from 'react-native';
import { FolderSwipeHost } from './FolderSwipeHost';

const event = {} as GestureResponderEvent;
const gesture = (dx = 0, dy = 0, vx = 0): PanResponderGestureState => ({
  dx, dy, vx, vy: 0, stateID: 1, moveX: dx, moveY: dy, x0: 0, y0: 0, numberActiveTouches: 1,
  _accountsForMovesUpTo: 0,
});

describe('folder swipe lifecycle', () => {
  let handlers: Parameters<typeof PanResponder.create>[0];
  beforeEach(() => {
    jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
      handlers = config;
      return { panHandlers: {} };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('commits a deliberate short fast flick', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><View /></FolderSwipeHost>);
    await act(async () => {
      handlers.onPanResponderGrant?.(event, gesture());
      handlers.onPanResponderRelease?.(event, gesture(-36, 3, -0.8));
    });
    expect(onSwipe).toHaveBeenCalledWith('next');
  });

  it('cancels an active gesture and releases refresh when disabled', async () => {
    const onSwipe = jest.fn();
    const onEngage = jest.fn();
    const view = await render(<FolderSwipeHost onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>);
    const started = handlers;
    await act(async () => { started.onPanResponderGrant?.(event, gesture()); });
    await view.rerender(<FolderSwipeHost enabled={false} onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>);
    expect(onEngage).toHaveBeenLastCalledWith(false);
    await act(async () => { started.onPanResponderRelease?.(event, gesture(-100, 0, -1)); });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('releases the parent refresh lock on unmount', async () => {
    const onEngage = jest.fn();
    const onSwipe = jest.fn();
    const view = await render(<FolderSwipeHost onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>);
    await act(async () => { handlers.onPanResponderGrant?.(event, gesture()); });
    await view.unmount();
    expect(onEngage).toHaveBeenLastCalledWith(false);
    await act(async () => {
      handlers.onPanResponderGrant?.(event, gesture());
      handlers.onPanResponderRelease?.(event, gesture(-100));
    });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('does not switch after a terminated or multi-touch gesture', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><View /></FolderSwipeHost>);
    await act(async () => {
      handlers.onPanResponderGrant?.(event, gesture());
      handlers.onPanResponderTerminate?.(event, gesture());
      handlers.onPanResponderRelease?.(event, gesture(-100));
      handlers.onPanResponderGrant?.(event, gesture());
      handlers.onPanResponderMove?.(event, { ...gesture(-100), numberActiveTouches: 2 });
      handlers.onPanResponderRelease?.(event, gesture(-100));
    });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('captures both gradual and fast horizontal starts before row actions', async () => {
    await render(<FolderSwipeHost capture onSwipeFolder={jest.fn()}><View /></FolderSwipeHost>);
    expect(handlers.onMoveShouldSetPanResponderCapture?.(event, gesture(-15, 1))).toBe(true);
    expect(handlers.onMoveShouldSetPanResponderCapture?.(event, gesture(-45, 3))).toBe(true);
    expect(handlers.onMoveShouldSetPanResponderCapture?.(event, gesture(5, 35))).toBe(false);
  });
});
