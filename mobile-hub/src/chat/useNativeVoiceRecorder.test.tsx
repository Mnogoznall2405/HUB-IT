import { act, render } from '@testing-library/react-native';
import * as audio from 'expo-audio';
import { useNativeVoiceRecorder } from './useNativeVoiceRecorder';

const mockRecorder = {
  uri: 'file:///voice.m4a', currentTime: 3, isRecording: false,
  prepareToRecordAsync: jest.fn(async (): Promise<void> => undefined),
  record: jest.fn(() => { mockRecorder.isRecording = true; }),
  stop: jest.fn(async () => { mockRecorder.isRecording = false; }),
};
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({ isRecording: mockRecorder.isRecording, durationMillis: 3000 }),
}));
let current: ReturnType<typeof useNativeVoiceRecorder>;
function Recorder() { current = useNativeVoiceRecorder(); return null; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { jest.useFakeTimers(); mockRecorder.isRecording = false; });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('does not start a microphone after cancellation during the permission prompt', async () => {
  const permission = deferred<any>();
  jest.spyOn(audio, 'requestRecordingPermissionsAsync').mockReturnValueOnce(permission.promise);
  await render(<Recorder />);
  let started!: Promise<boolean>;
  await act(async () => { started = current.startVoiceRecording(); });
  let cancelled!: Promise<void>;
  await act(async () => { cancelled = current.cancelVoiceRecording(); });
  await act(async () => { permission.resolve({ granted: true }); await started; await cancelled; });
  expect(mockRecorder.record).not.toHaveBeenCalled();
});

it('does not start a microphone after unmount during native preparation', async () => {
  const preparation = deferred<void>();
  mockRecorder.prepareToRecordAsync.mockReturnValueOnce(preparation.promise);
  const view = await render(<Recorder />);
  let started!: Promise<boolean>;
  await act(async () => { started = current.startVoiceRecording(); });
  await view.unmount();
  await act(async () => { preparation.resolve(); await started; });
  expect(mockRecorder.record).not.toHaveBeenCalled();
});

it('coalesces rapid starts before React has rendered the recording state', async () => {
  await render(<Recorder />);
  await act(async () => { await Promise.all([current.startVoiceRecording(), current.startVoiceRecording()]); });
  expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  expect(mockRecorder.record).toHaveBeenCalledTimes(1);
});

it('releasing a hold during preparation waits and hands off exactly one recording', async () => {
  const preparation = deferred<void>();
  mockRecorder.prepareToRecordAsync.mockReturnValueOnce(preparation.promise);
  await render(<Recorder />);
  let started!: Promise<boolean>, stopped!: ReturnType<typeof current.stopVoiceRecording>;
  await act(async () => { started = current.startVoiceRecording(); });
  await act(async () => { stopped = current.stopVoiceRecording(); });
  let result: unknown;
  await act(async () => { preparation.resolve(); await started; result = await stopped; });
  expect(result).toEqual(expect.objectContaining({ uri: mockRecorder.uri }));
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
});

it('does not hand the same voice file to two simultaneous send actions', async () => {
  const stopped = deferred<void>();
  mockRecorder.stop.mockImplementationOnce(async () => { await stopped.promise; mockRecorder.isRecording = false; });
  await render(<Recorder />);
  await act(async () => { await current.startVoiceRecording(); });
  let first!: ReturnType<typeof current.stopVoiceRecording>, second!: ReturnType<typeof current.stopVoiceRecording>;
  await act(async () => { first = current.stopVoiceRecording(); second = current.stopVoiceRecording(); });
  let results: unknown[] = [];
  await act(async () => { stopped.resolve(); results = await Promise.all([first, second]); });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(results.filter(Boolean)).toHaveLength(1);
});


it('cancellation during native stop suppresses file handoff', async () => {
  const stopping = deferred<void>();
  mockRecorder.stop.mockImplementationOnce(async () => { await stopping.promise; mockRecorder.isRecording = false; });
  await render(<Recorder />);
  await act(async () => { await current.startVoiceRecording(); });
  let stopped!: ReturnType<typeof current.stopVoiceRecording>, cancelled!: Promise<void>;
  await act(async () => { stopped = current.stopVoiceRecording(); });
  await act(async () => { cancelled = current.cancelVoiceRecording(); });
  let result: unknown;
  await act(async () => { stopping.resolve(); result = await stopped; await cancelled; });
  expect(result).toBeNull();
});

it('hands off duration measured at stop rather than the last UI tick', async () => {
  await render(<Recorder />);
  await act(async () => { await current.startVoiceRecording(); });
  jest.setSystemTime(Date.now() + 5200);
  let result: Awaited<ReturnType<typeof current.stopVoiceRecording>> = null;
  await act(async () => { result = await current.stopVoiceRecording(); });
  expect(result).toEqual(expect.objectContaining({ durationSeconds: 5 }));
});

it('can retry a failed native stop without losing the active recording', async () => {
  await render(<Recorder />);
  await act(async () => { await current.startVoiceRecording(); });
  mockRecorder.stop.mockRejectedValueOnce(new Error('native busy'));
  await act(async () => { await expect(current.stopVoiceRecording()).rejects.toThrow('native busy'); });
  let result: unknown;
  await act(async () => { result = await current.stopVoiceRecording(); });
  expect(result).toEqual(expect.objectContaining({ uri: mockRecorder.uri }));
});


it('reports a blocked start during cancellation without acquiring the microphone', async () => {
  const preparation = deferred<void>();
  mockRecorder.prepareToRecordAsync.mockReturnValueOnce(preparation.promise);
  await render(<Recorder />);
  let started!: Promise<boolean>, cancelled!: Promise<void>;
  await act(async () => { started = current.startVoiceRecording(); });
  await act(async () => { cancelled = current.cancelVoiceRecording(); });
  await act(async () => { preparation.resolve(); expect(await started).toBe(false); await cancelled; });
  expect(mockRecorder.record).not.toHaveBeenCalled();
  await act(async () => { expect(await current.startVoiceRecording()).toBe(true); });
});

it('releases a prepared recorder if native record fails', async () => {
  await render(<Recorder />);
  mockRecorder.record.mockImplementationOnce(() => { throw new Error('record failed'); });
  await act(async () => { await expect(current.startVoiceRecording()).rejects.toThrow('record failed'); });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await current.startVoiceRecording()).toBe(true); });
});
