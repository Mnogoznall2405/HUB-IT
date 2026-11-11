import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useUnsavedFormGuard } from './useUnsavedFormGuard';

const mockDispatch = jest.fn();
let mockPrevented = false;
let mockCallback: (event: { data: { action: { type: string } } }) => void;
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  usePreventRemove: (prevented: boolean, callback: typeof mockCallback) => {
    mockPrevented = prevented;
    mockCallback = callback;
  },
}));

beforeEach(() => { mockDispatch.mockClear(); });
afterEach(() => jest.restoreAllMocks());

it('keeps the form on cancel, avoids duplicate prompts and replays the original Back only after confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = await renderHook(() => useUnsavedFormGuard(true));
  const action = { type: 'GO_BACK' };
  await act(async () => { mockCallback({ data: { action } }); mockCallback({ data: { action } }); });
  expect(alert).toHaveBeenCalledTimes(1);
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls[0][2]?.[0].onPress?.());
  expect(mockPrevented).toBe(true);
  await act(async () => mockCallback({ data: { action } }));
  await act(async () => alert.mock.calls[1][2]?.[1].onPress?.());
  expect(mockPrevented).toBe(false);
  expect(mockDispatch).toHaveBeenCalledWith(action);
  await view.unmount();
});

it('blocks departure during saving and removes the guard before successful navigation', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const navigate = jest.fn(() => expect(mockPrevented).toBe(false));
  const view = await renderHook(() => useUnsavedFormGuard(true, true));
  await act(async () => view.result.current.requestLeave(navigate));
  expect(alert).toHaveBeenCalledWith('Сохранение', 'Дождитесь завершения операции.');
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => view.result.current.leaveSaved(navigate));
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('leaves an unchanged form immediately', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const navigate = jest.fn();
  const view = await renderHook(() => useUnsavedFormGuard(false));
  await act(async () => view.result.current.requestLeave(navigate));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

it('waits for durable save before leaving and stays on failure so the same action can retry', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let finish: () => void = () => undefined;
  const save = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const error = jest.fn();
  const navigate = jest.fn();
  const view = await renderHook(() => useUnsavedFormGuard(true, false, {
    title: 'Сохранить черновик и выйти?', message: 'Локальная копия', confirmLabel: 'Сохранить и выйти', beforeLeave: save, onLeaveError: error,
  }));
  await act(async () => view.result.current.requestLeave(navigate));
  expect(alert.mock.calls[0][2]?.[1].text).toBe('Сохранить и выйти');
  await act(async () => alert.mock.calls[0][2]?.[1].onPress?.());
  expect(navigate).not.toHaveBeenCalled(); expect(error).toHaveBeenCalled(); expect(mockPrevented).toBe(true);
  await act(async () => view.result.current.requestLeave(navigate));
  await act(async () => alert.mock.calls[1][2]?.[1].onPress?.());
  expect(navigate).not.toHaveBeenCalled(); expect(mockPrevented).toBe(true);
  await act(async () => { finish(); });
  expect(navigate).toHaveBeenCalledTimes(1); expect(mockPrevented).toBe(false);
  await view.unmount();
});
