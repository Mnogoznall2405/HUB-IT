import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import type { ChatMediaItem } from '../../chat/chatMedia';
import { ChatMediaViewer } from './ChatMediaViewer';

jest.mock('./ChatAuthenticatedImage', () => ({ ChatAuthenticatedImage: () => null }));
jest.mock('./ChatVideoPlayer', () => ({ ChatVideoPlayer: () => null }));
const mockReduced = jest.fn(() => false);
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));

const items: ChatMediaItem[] = ['a', 'b', 'c'].map((id) => ({
  message: { id: `message-${id}`, conversation_id: 'conversation', sender_user_id: 1 },
  attachment: { id, kind: 'image', file_name: `${id}.jpg`, preview_url: `file:///preview-${id}.jpg`, original_url: `file:///original-${id}.jpg` },
}));
const actions = { onClose: jest.fn(), onOpen: jest.fn(), onShare: jest.fn(), onSave: jest.fn(), onForward: jest.fn() };

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); mockReduced.mockReturnValue(false); });

it('updates the visible zoom action and resets zoom on a second activation', async () => {
  mockReduced.mockReturnValue(true);
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} />);
  await fireEvent.press(view.getByLabelText('Увеличить фото'));
  expect(view.getByLabelText('Уменьшить фото')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Уменьшить фото'));
  expect(view.getByLabelText('Увеличить фото')).toBeTruthy();
});

it('does not steal the video scrub gesture and keeps explicit navigation available', async () => {
  const responder = jest.spyOn(PanResponder, 'create');
  const video = { ...items[0], attachment: { ...items[0].attachment, kind: 'video' as const, mime_type: 'video/mp4' } };
  const view = await render(<ChatMediaViewer {...actions} item={video} items={[video, items[1]]} onChange={jest.fn()} />);
  const config = responder.mock.calls[responder.mock.calls.length - 1][0];
  const event = { nativeEvent: { touches: [{}, {}] } } as never;
  const gesture = { dx: 120, dy: 10 } as never;
  expect(config.onStartShouldSetPanResponder?.(event, gesture)).toBe(false);
  expect(config.onMoveShouldSetPanResponder?.(event, gesture)).toBe(false);
  expect(config.onMoveShouldSetPanResponderCapture?.(event, gesture)).toBe(false);
  expect(view.getByLabelText('Следующее фото')).toBeTruthy();
});

it('keeps toolbar geometry when hiding chrome and supports double-tap zoom out', async () => {
  jest.useFakeTimers();
  mockReduced.mockReturnValue(true);
  const responder = jest.spyOn(PanResponder, 'create');
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} />);
  const tap = async () => {
    const config = responder.mock.calls[responder.mock.calls.length - 1][0];
    const event = { nativeEvent: { touches: [], locationX: 100, locationY: 100 } } as never;
    const gesture = { dx: 0, dy: 0, vx: 0, vy: 0 } as never;
    await act(async () => { config.onPanResponderGrant?.(event, gesture); config.onPanResponderRelease?.(event, gesture); });
  };
  await tap();
  await act(async () => { jest.advanceTimersByTime(300); });
  const hiddenTop = view.getByTestId('chat-media-top-bar', { includeHiddenElements: true });
  const hiddenActions = view.getByTestId('chat-media-actions', { includeHiddenElements: true });
  expect(hiddenTop).toHaveStyle({ opacity: 0 });
  expect(hiddenActions.props.pointerEvents).toBe('none');
  expect(hiddenActions.props.importantForAccessibility).toBe('no-hide-descendants');
  await tap();
  await act(async () => { jest.advanceTimersByTime(300); });
  await fireEvent.press(view.getByLabelText('Увеличить фото'));
  await tap();
  await act(async () => { jest.advanceTimersByTime(100); });
  await tap();
  expect(view.getByLabelText('Увеличить фото')).toBeTruthy();
});

it('cancels an in-flight page transition on rotation and permits the next navigation', async () => {
  let finish: (result: { finished: boolean }) => void = () => {};
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (callback) => { finish = callback || (() => {}); }, stop: jest.fn(), reset: jest.fn() }));
  const onChange = jest.fn();
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} items={items} onChange={onChange} />);
  await fireEvent(view.getByTestId('chat-media-viewer-stage'), 'layout', { nativeEvent: { layout: { width: 320, height: 600 } } });
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  const oldFinish = finish;
  await fireEvent(view.getByTestId('chat-media-viewer-stage'), 'layout', { nativeEvent: { layout: { width: 600, height: 320 } } });
  await act(async () => { oldFinish({ finished: true }); });
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  await act(async () => { finish({ finished: true }); });
  expect(onChange).toHaveBeenCalledWith(items[1]);
});

it('does not snap the old frame to the center before committing the next photo', async () => {
  let finish: (result: { finished: boolean }) => void = () => {};
  let outgoing: Animated.Value | undefined;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
    start: (callback) => {
      outgoing = value as Animated.Value;
      outgoing.setValue(Number(config.toValue));
      finish = callback || (() => {});
    }, stop: jest.fn(), reset: jest.fn(),
  }));
  const onChange = jest.fn();
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} items={items} onChange={onChange} />);
  await fireEvent(view.getByTestId('chat-media-viewer-stage'), 'layout', { nativeEvent: { layout: { width: 320, height: 640 } } });
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  expect(Animated.timing).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ finished: true }); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(items[1]);
  expect((outgoing as unknown as { __getValue(): number }).__getValue()).toBe(-320);
  await view.rerender(<ChatMediaViewer {...actions} item={items[1]} items={items} onChange={onChange} />);
  const transform = StyleSheet.flatten(view.getByTestId('chat-media-current-slot').props.style).transform as { translateX: number }[];
  expect(transform[0].translateX).toBe(0);
  expect(view.getByText('2 / 3')).toBeTruthy();
});

it('ignores completion of an old swipe after the viewer switches to another photo', async () => {
  let finish: (result: { finished: boolean }) => void = () => {};
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (callback) => { finish = callback || (() => {}); }, stop: jest.fn(), reset: jest.fn() }));
  const onChange = jest.fn();
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} items={items} onChange={onChange} />);
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  await view.rerender(<ChatMediaViewer {...actions} item={items[2]} items={items} onChange={onChange} />);
  await act(async () => { finish({ finished: true }); });
  expect(onChange).not.toHaveBeenCalled();
  expect(view.getByText('3 / 3')).toBeTruthy();
});

it('does not open a removed gallery item when its pending swipe completes', async () => {
  let finish: (result: { finished: boolean }) => void = () => {};
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (callback) => { finish = callback || (() => {}); }, stop: jest.fn(), reset: jest.fn() }));
  const onChange = jest.fn();
  const view = await render(<ChatMediaViewer {...actions} item={items[0]} items={items} onChange={onChange} />);
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  await view.rerender(<ChatMediaViewer {...actions} item={items[0]} items={[items[0], items[2]]} onChange={onChange} />);
  await act(async () => { finish({ finished: true }); });
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  await act(async () => { finish({ finished: true }); });
  expect(onChange).toHaveBeenCalledWith(items[2]);
});

it.each(['button', 'hardware back'])('cancels swipe completion immediately on %s even before the parent unmounts the viewer', async (closeAction) => {
  let finish: (result: { finished: boolean }) => void = () => {};
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (callback) => { finish = callback || (() => {}); }, stop: jest.fn(), reset: jest.fn() }));
  const onChange = jest.fn();
  const onClose = jest.fn();
  const view = await render(<ChatMediaViewer {...actions} onClose={onClose} item={items[0]} items={items} onChange={onChange} />);
  await fireEvent.press(view.getByLabelText('Следующее фото'));
  if (closeAction === 'button') await fireEvent.press(view.getByLabelText('Закрыть просмотр'));
  else await fireEvent(view.getByTestId('chat-media-modal'), 'requestClose');
  await act(async () => { finish({ finished: true }); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});

it('changes pages without animation with reduced motion', async () => {
  mockReduced.mockReturnValue(true);
  const onChange = jest.fn();
  const timing = jest.spyOn(Animated, 'timing');
  const view = await render(<ChatMediaViewer {...actions} item={items[1]} items={items} onChange={onChange} />);
  await fireEvent.press(view.getByLabelText('Предыдущее фото'));
  expect(onChange).toHaveBeenCalledWith(items[0]);
  expect(timing).not.toHaveBeenCalled();
});

it('updates current top, bottom and side insets without replacing the selected photo', async () => {
  const props = { ...actions, item: items[0], items, onChange: jest.fn() };
  const view = await render(<SafeAreaInsetsContext.Provider value={{ top: 60, bottom: 34, left: 0, right: 0 }}><ChatMediaViewer {...props} /></SafeAreaInsetsContext.Provider>);
  expect(view.getByTestId('chat-media-safe-area')).toHaveStyle({ paddingTop: 60, paddingBottom: 34 });
  await view.rerender(<SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 44, right: 20 }}><ChatMediaViewer {...props} /></SafeAreaInsetsContext.Provider>);
  expect(view.getByTestId('chat-media-safe-area')).toHaveStyle({ paddingTop: 0, paddingBottom: 12, paddingLeft: 44, paddingRight: 20 });
  expect(props.onChange).not.toHaveBeenCalled();
});
