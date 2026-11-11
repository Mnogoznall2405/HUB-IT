import { getChatDeviceLogSnapshot, logChatDevice, resetChatDeviceLog } from './chatDeviceLog';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }));

describe('chat device log privacy', () => {
  beforeEach(async () => {
    await resetChatDeviceLog();
  });

  it('keeps tokens and numbers but drops free text, ids and bad event names', () => {
    logChatDevice('sheet_open', {
      sheet: 'forward',
      ms: 41.26,
      title: 'Секретный чат Иванова',
      conversation: '3f2c1a9e-7d44-4b0a-9a55-0c5b2d1f77aa',
      ok: true,
    });
    logChatDevice('Not A Token', { a: 1 });

    const snapshot = getChatDeviceLogSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].e).toBe('sheet_open');
    expect(snapshot[0].f).toEqual({ sheet: 'forward', ms: 41.3, ok: true });
  });
});
