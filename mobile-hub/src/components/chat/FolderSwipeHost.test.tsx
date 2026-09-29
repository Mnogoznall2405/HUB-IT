import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import type { PanGesture } from 'react-native-gesture-handler';
import { FolderSwipeHost } from './FolderSwipeHost';

let lastGesture: PanGesture | null = null;

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: PanGesture; children: React.ReactNode }) => {
      lastGesture = gesture;
      return children;
    },
  };
});

const manager = () => ({
  activate: jest.fn(),
  fail: jest.fn(),
});

const touch = (x: number, y: number) => ({
  allTouches: [{ x, y }],
  changedTouches: [{ x, y }],
});

const update = (dx: number, dy = 0, vx = 0) => ({
  translationX: dx,
  translationY: dy,
  velocityX: vx,
});

describe('folder swipe lifecycle', () => {
  beforeEach(() => { lastGesture = null; });
  afterEach(() => jest.restoreAllMocks());

  const handlers = () => (lastGesture as unknown as {
    handlers: Record<string, (...args: never[]) => void>;
  }).handlers;

  it('commits a deliberate short fast flick', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><View /></FolderSwipeHost>);
    const mgr = manager();
    await act(async () => {
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
      handlers().onUpdate?.(update(50, 3) as never);
      handlers().onEnd?.(update(-36, 3, -0.8) as never);
    });
    expect(mgr.activate).toHaveBeenCalled();
    expect(onSwipe).toHaveBeenCalledWith('next');
  });

  it('cancels an active gesture and releases refresh when disabled', async () => {
    const onSwipe = jest.fn();
    const onEngage = jest.fn();
    const view = await render(
      <FolderSwipeHost onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>,
    );
    const engaged = handlers();
    const mgr = manager();
    await act(async () => {
      engaged.onTouchesDown?.(touch(10, 10) as never, mgr as never);
      engaged.onTouchesMove?.(touch(60, 13) as never, mgr as never);
      engaged.onUpdate?.(update(50, 3) as never);
    });
    await view.rerender(
      <FolderSwipeHost enabled={false} onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>,
    );
    expect(onEngage).toHaveBeenLastCalledWith(false);
    await act(async () => { handlers().onEnd?.(update(-100, 0, -1) as never); });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('releases the parent refresh lock on unmount', async () => {
    const onEngage = jest.fn();
    const onSwipe = jest.fn();
    const view = await render(
      <FolderSwipeHost onSwipeFolder={onSwipe} onSwipeEngage={onEngage}><View /></FolderSwipeHost>,
    );
    const mgr = manager();
    await act(async () => {
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
      handlers().onUpdate?.(update(50, 3) as never);
    });
    await view.unmount();
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('does not switch after a terminated or multi-touch gesture', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><View /></FolderSwipeHost>);
    const mgr = manager();
    await act(async () => {
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.({ allTouches: [{ x: 60, y: 13 }, { x: 90, y: 40 }], changedTouches: [{ x: 60, y: 13 }] } as never, mgr as never);
      handlers().onFinalize?.();
    });
    expect(mgr.fail).toHaveBeenCalled();
    // After fail/finalize the gesture ends without onEnd — no folder switch.
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
