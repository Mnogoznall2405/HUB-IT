import type { ComponentProps } from 'react';
import { act, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { NativeChatComposerDock } from './NativeChatComposerDock';
import type { ChatComposer } from './ChatComposer';

let mockComposerProps: ComponentProps<typeof ChatComposer>;
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockCancel = jest.fn();

jest.mock('./ChatComposer', () => ({
  ChatComposer: (props: ComponentProps<typeof ChatComposer>) => { mockComposerProps = props; return null; },
}));
jest.mock('../../chat/useNativeVoiceRecorder', () => ({
  NativeMicrophonePermissionError: class extends Error {},
  useNativeVoiceRecorder: () => ({
    voiceRecording: false, voiceRecordingDuration: 0, voiceRecordingLevel: null,
    startVoiceRecording: mockStart, stopVoiceRecording: mockStop, cancelVoiceRecording: mockCancel,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const file = { uri: 'file:///voice.m4a', name: 'voice.m4a', mimeType: 'audio/mp4', size: 20,
  source: 'voice' as const, durationSeconds: 3 };
const props = () => ({ value: '', onChangeText: jest.fn(), onSend: jest.fn(), onSendVoiceFile: jest.fn(async (): Promise<void> => undefined) });

beforeEach(() => {
  mockStart.mockReset().mockResolvedValue(true);
  mockStop.mockReset().mockResolvedValue(file);
  mockCancel.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('hands off voice once when send is pressed twice before native stop finishes', async () => {
  const input = props(), stopping = deferred<typeof file>();
  mockStop.mockReturnValue(stopping.promise);
  await render(<NativeChatComposerDock {...input} />);
  await act(async () => { mockComposerProps.onSendVoice?.(); mockComposerProps.onSendVoice?.(); });
  expect(mockStop).toHaveBeenCalledTimes(1);
  await act(async () => { stopping.resolve(file); });
  expect(input.onSendVoiceFile).toHaveBeenCalledTimes(1);
  expect(input.onSendVoiceFile).toHaveBeenCalledWith(file, { mediaKind: 'audio', durationSeconds: 3 });
});

it.each(['cancel', 'permission', 'edit', 'unmount'] as const)('does not hand off a late native file after %s', async (change) => {
  const input = props(), stopping = deferred<typeof file>();
  mockStop.mockReturnValue(stopping.promise);
  const view = await render(<NativeChatComposerDock {...input} />);
  await act(async () => { mockComposerProps.onSendVoice?.(); });
  if (change === 'cancel') await act(async () => { mockComposerProps.onCancelVoice?.(); });
  if (change === 'permission') await view.rerender(<NativeChatComposerDock {...input} canRecord={false} />);
  if (change === 'edit') await view.rerender(<NativeChatComposerDock {...input} mode="edit" />);
  if (change === 'unmount') await view.unmount();
  await act(async () => { stopping.resolve(file); });
  expect(input.onSendVoiceFile).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('does not show a stale start error after cancellation and allows a fresh attempt', async () => {
  const starting = deferred<boolean>();
  mockStart.mockReturnValueOnce(starting.promise);
  await render(<NativeChatComposerDock {...props()} />);
  await act(async () => { mockComposerProps.onMicPress?.(); });
  await act(async () => { mockComposerProps.onCancelVoice?.(); starting.reject(Error('late permission error')); });
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => { mockComposerProps.onMicPress?.(); });
  expect(mockStart).toHaveBeenCalledTimes(2);
});

it('blocks another recording until the previous file handoff finishes', async () => {
  const input = props(), sending = deferred<void>();
  input.onSendVoiceFile.mockReturnValueOnce(sending.promise);
  await render(<NativeChatComposerDock {...input} />);
  await act(async () => { mockComposerProps.onSendVoice?.(); });
  await act(async () => { mockComposerProps.onMicPress?.(); });
  expect(mockStart).not.toHaveBeenCalled();
  await act(async () => { sending.resolve(); });
  await act(async () => { mockComposerProps.onMicPress?.(); });
  expect(mockStart).toHaveBeenCalledTimes(1);
});

it('coalesces repeated microphone gestures while permission is pending', async () => {
  const starting = deferred<boolean>();
  mockStart.mockReturnValueOnce(starting.promise);
  await render(<NativeChatComposerDock {...props()} />);
  await act(async () => { mockComposerProps.onMicPress?.(); mockComposerProps.onMicHoldStart?.(); });
  expect(mockStart).toHaveBeenCalledTimes(1);
  await act(async () => { starting.resolve(true); });
});

it('releases the microphone hold after native start declines during cancellation', async () => {
  mockStart.mockResolvedValueOnce(false);
  await render(<NativeChatComposerDock {...props()} />);
  await act(async () => { mockComposerProps.onMicPress?.(); });
  await act(async () => { mockComposerProps.onMicPress?.(); });
  expect(mockStart).toHaveBeenCalledTimes(2);
});
