import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { PanResponder } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type { ChatConversationSummary } from '../../api/types';
import {
  FolderSwipeGestureContext,
  type FolderSwipeGestureSync,
} from './FolderSwipeHost';
import { SwipeableConversationRow } from './SwipeableConversationRow';

const item: ChatConversationSummary = {
  id: 'c1',
  kind: 'direct',
  title: 'Мария',
  unread_count: 2,
};

const makeSync = (overrides: Partial<FolderSwipeGestureSync> = {}): FolderSwipeGestureSync => ({
  rowTouchActive: { value: 0 } as unknown as SharedValue<number>,
  rowsSuppressed: { value: 0 } as unknown as SharedValue<number>,
  ...overrides,
});

const WithSync = ({ sync, children }: { sync: FolderSwipeGestureSync; children: ReactNode }) => (
  <FolderSwipeGestureContext.Provider value={sync}>
    {children}
  </FolderSwipeGestureContext.Provider>
);

type PanConfig = {
  onMoveShouldSetPanResponder?: (event: unknown, gesture: { dx: number; dy: number }) => boolean;
  onMoveShouldSetPanResponderCapture?: (event: unknown, gesture: { dx: number; dy: number }) => boolean;
  onPanResponderRelease?: (event: unknown, gesture: { dx: number; dy: number }) => void;
};

// PanResponder panHandlers track gesture state internally, so the row's
// should-set/release logic is exercised through the captured create() config.
const panConfig = (createSpy: jest.SpyInstance): PanConfig => (
  createSpy.mock.calls[0][0] as PanConfig
);

// The panHandlers view is the only node carrying responder negotiation props.
const swipeZone = (view: Awaited<ReturnType<typeof render>>) => view.container.queryAll(
  (node) => typeof node.props.onMoveShouldSetResponder === 'function',
)[0];

describe('SwipeableConversationRow ↔ folder pager coordination (CHAT-INBOX-06)', () => {
  let createSpy: jest.SpyInstance;
  beforeEach(() => {
    createSpy = jest.spyOn(PanResponder, 'create');
  });

  it('marks its touch zone on touch start and releases it on end/cancel', async () => {
    const sync = makeSync();
    const view = await render(
      <WithSync sync={sync}>
        <SwipeableConversationRow item={item} onPress={jest.fn()} />
      </WithSync>,
    );
    const zone = swipeZone(view);
    zone.props.onTouchStart();
    expect(sync.rowTouchActive.value).toBe(1);
    zone.props.onTouchEnd();
    expect(sync.rowTouchActive.value).toBe(0);
    zone.props.onTouchStart();
    zone.props.onTouchCancel();
    expect(sync.rowTouchActive.value).toBe(0);
  });

  it('claims horizontal swipes in both directions', async () => {
    await render(
      <WithSync sync={makeSync()}>
        <SwipeableConversationRow item={item} onPress={jest.fn()} />
      </WithSync>,
    );
    const config = panConfig(createSpy);
    expect(config.onMoveShouldSetPanResponder?.({}, { dx: 30, dy: 4 })).toBe(true);
    expect(config.onMoveShouldSetPanResponderCapture?.({}, { dx: 30, dy: 4 })).toBe(true);
    expect(config.onMoveShouldSetPanResponder?.({}, { dx: -30, dy: 4 })).toBe(true);
    // Vertical-dominant drags still belong to the list scroller.
    expect(config.onMoveShouldSetPanResponder?.({}, { dx: 30, dy: 40 })).toBe(false);
  });

  it('runs the mute action on release — the swipe is no longer stolen', async () => {
    const onMute = jest.fn();
    await render(
      <WithSync sync={makeSync()}>
        <SwipeableConversationRow item={item} onPress={jest.fn()} onMute={onMute} />
      </WithSync>,
    );
    await act(async () => {
      panConfig(createSpy).onPanResponderRelease?.({}, { dx: 80, dy: 0 });
    });
    expect(onMute).toHaveBeenCalledWith(item);
  });

  it('refuses to claim while an engaged captured folder swipe suppresses rows', async () => {
    const sync = makeSync({ rowsSuppressed: { value: 1 } as unknown as SharedValue<number> });
    await render(
      <WithSync sync={sync}>
        <SwipeableConversationRow item={item} onPress={jest.fn()} />
      </WithSync>,
    );
    const config = panConfig(createSpy);
    const gesture = { dx: 30, dy: 2 };
    expect(config.onMoveShouldSetPanResponder?.({}, gesture)).toBe(false);
    expect(config.onMoveShouldSetPanResponderCapture?.({}, gesture)).toBe(false);
    // Suppression lifts with the folder gesture.
    sync.rowsSuppressed.value = 0;
    expect(config.onMoveShouldSetPanResponder?.({}, gesture)).toBe(true);
  });

  it('still swipes when no FolderSwipeHost is mounted', async () => {
    const view = await render(<SwipeableConversationRow item={item} onPress={jest.fn()} />);
    const config = panConfig(createSpy);
    expect(config.onMoveShouldSetPanResponder?.({}, { dx: 30, dy: 2 })).toBe(true);
    expect(() => swipeZone(view).props.onTouchStart()).not.toThrow();
  });
});
