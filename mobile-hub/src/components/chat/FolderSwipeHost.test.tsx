import { act, render } from '@testing-library/react-native';
import { useContext } from 'react';
import { View } from 'react-native';
import type { PanGesture } from 'react-native-gesture-handler';
import {
  FolderSwipeGestureContext,
  FolderSwipeHost,
  type FolderSwipeGestureSync,
} from './FolderSwipeHost';

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

const handlers = () => (lastGesture as unknown as {
  handlers: Record<string, (...args: never[]) => void>;
}).handlers;

describe('folder swipe lifecycle', () => {
  beforeEach(() => { lastGesture = null; });
  afterEach(() => jest.restoreAllMocks());

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

describe('row ↔ folder pager coordination (CHAT-INBOX-06)', () => {
  let sync: FolderSwipeGestureSync | null = null;
  const Probe = () => {
    sync = useContext(FolderSwipeGestureContext);
    return null;
  };
  beforeEach(() => { sync = null; });

  it('fails activation while a conversation row owns the touch, then pages a free touch', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><Probe /></FolderSwipeHost>);
    expect(sync).not.toBeNull();
    const mgr = manager();
    await act(async () => {
      sync!.rowTouchActive.value = 1;
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
      handlers().onFinalize?.();
    });
    expect(mgr.activate).not.toHaveBeenCalled();
    expect(mgr.fail).toHaveBeenCalled();
    expect(onSwipe).not.toHaveBeenCalled();

    const free = manager();
    await act(async () => {
      sync!.rowTouchActive.value = 0;
      handlers().onTouchesDown?.(touch(10, 10) as never, free as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, free as never);
    });
    expect(free.activate).toHaveBeenCalled();
  });

  it('releases the refresh lock when a row touch denies activation', async () => {
    const onEngage = jest.fn();
    const view = await render(
      <FolderSwipeHost onSwipeFolder={jest.fn()} onSwipeEngage={onEngage}><Probe /></FolderSwipeHost>,
    );
    // The host view carries the JS-side refresh-lock heuristic props.
    const host = view.container.queryAll(
      (node) => typeof node.props.onTouchMove === 'function',
    )[0];
    const mgr = manager();
    await act(async () => {
      host.props.onTouchStart({ nativeEvent: { touches: [{ pageX: 10, pageY: 10 }] } });
      // dx=50 → shouldLockInboxRefresh fires before the pager decides anything.
      host.props.onTouchMove({ nativeEvent: { touches: [{ pageX: 60, pageY: 12 }] } });
    });
    expect(onEngage).toHaveBeenLastCalledWith(true);
    await act(async () => {
      sync!.rowTouchActive.value = 1;
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
      handlers().onFinalize?.();
      host.props.onTouchEnd({ nativeEvent: { touches: [] } });
    });
    expect(mgr.activate).not.toHaveBeenCalled();
    expect(onEngage).toHaveBeenLastCalledWith(false);
  });

  it('suppresses row responders only while a captured swipe is engaged', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost capture onSwipeFolder={onSwipe}><Probe /></FolderSwipeHost>);
    const mgr = manager();
    await act(async () => {
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
    });
    expect(mgr.activate).toHaveBeenCalled();
    expect(sync!.rowsSuppressed.value).toBe(1);
    await act(async () => { handlers().onFinalize?.(); });
    expect(sync!.rowsSuppressed.value).toBe(0);
  });

  it('does not suppress rows when capture is off', async () => {
    const onSwipe = jest.fn();
    await render(<FolderSwipeHost onSwipeFolder={onSwipe}><Probe /></FolderSwipeHost>);
    const mgr = manager();
    await act(async () => {
      handlers().onTouchesDown?.(touch(10, 10) as never, mgr as never);
      handlers().onTouchesMove?.(touch(60, 13) as never, mgr as never);
    });
    expect(mgr.activate).toHaveBeenCalled();
    expect(sync!.rowsSuppressed.value).toBe(0);
  });
});
