import * as Notifications from 'expo-notifications';
import { act, render } from '@testing-library/react-native';
import { ReleaseHealthTracker } from './ReleaseHealthTracker';
import {
  recordReleaseHealthMetric,
  startReleaseHealthSession,
} from './diagnostics';

jest.mock('./diagnostics', () => ({
  recordReleaseHealthMetric: jest.fn(async () => undefined),
  startReleaseHealthSession: jest.fn(async () => undefined),
}));

describe('ReleaseHealthTracker', () => {
  it('records one local session and foreground notification receipts', async () => {
    const remove = jest.fn();
    jest.mocked(Notifications.addNotificationReceivedListener).mockReturnValueOnce({ remove });

    const view = await render(<ReleaseHealthTracker />);
    expect(startReleaseHealthSession).toHaveBeenCalledTimes(1);

    const listener = jest.mocked(Notifications.addNotificationReceivedListener).mock.calls[0]?.[0];
    await act(async () => {
      listener?.({} as never);
    });
    expect(recordReleaseHealthMetric).toHaveBeenCalledWith('push_received');

    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
