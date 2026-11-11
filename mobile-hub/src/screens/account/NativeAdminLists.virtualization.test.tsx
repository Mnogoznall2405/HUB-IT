import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { NativeAdminUsersScreen } from './NativeAdminUsersScreen';
import { NativeAdminSessionsScreen } from './NativeAdminSessionsScreen';
import { NativePcRemainingSheet } from '../statistics/NativePcRemainingSheet';
import * as users from '../../api/authUserAdminApi';
import * as sessions from '../../api/authSessionsApi';
import * as statistics from '../../api/statisticsApi';

let mockOffline = false;
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' }, hasPermission: () => true, offlineMode: mockOffline }) }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'light' } }) }));
jest.mock('../../api/authUserAdminApi');
jest.mock('../../api/authSessionsApi');
jest.mock('../../api/statisticsApi');
jest.mock('../../api/databaseApi', () => ({ listAvailableDatabases: jest.fn(async () => []) }));
beforeEach(() => { AppState.currentState = 'active'; mockOffline = false; jest.clearAllMocks(); });
afterEach(() => jest.restoreAllMocks());

describe.each([100, 500])('bounded mounted rows with %i records', count => {
  it('keeps user pagination while rendering only a window', async () => {
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, username: `audit-user-${i}`, full_name: `Audit User ${i}`, role: 'viewer', is_active: true, permissions: [] }));
    jest.mocked(users.searchUsers).mockImplementation(async ({ offset = 0, limit = 50 } = {}) => ({ items: rows.slice(offset, offset + limit), total: count, offset, limit, has_more: offset + limit < count }));
    const view = await render(<NativeAdminUsersScreen />);
    await waitFor(() => expect(view.getAllByText(/^Audit User /).length).toBe(12));
    for (let expected = 100; expected <= count; expected += 50) {
      await act(async () => { fireEvent.press(view.getByText('Показать ещё')); });
      await waitFor(() => expect(view.getByText(`Показано: ${expected} из ${count}`)).toBeTruthy());
    }
    expect(view.getAllByText(/^Audit User /).length).toBe(12);
  });
  it('bounds sessions and clears them when connectivity is lost', async () => {
    jest.mocked(sessions.listSessions).mockResolvedValue(Array.from({ length: count }, (_, i) => ({ session_id: String(i), user_id: i, username: `audit-session-${i}`, status: 'terminated' })));
    const view = await render(<NativeAdminSessionsScreen />);
    await waitFor(() => expect(view.getAllByText(/^audit-session-/).length).toBe(12));
    mockOffline = true;
    await view.rerender(<NativeAdminSessionsScreen />);
    expect(view.queryAllByText(/^audit-session-/)).toHaveLength(0);
    mockOffline = false;
    await view.rerender(<NativeAdminSessionsScreen />);
    await waitFor(() => expect(view.getAllByText(/^audit-session-/).length).toBe(12));
    expect(sessions.listSessions).toHaveBeenCalledTimes(2);
  });
  it('bounds remaining-PC rows', async () => {
    const rows = Array.from({ length: count }, (_, i) => ({ inv_no: `audit-pc-${i}`, serial_no: `serial-${i}`, hw_serial_no: '', location: '', model_name: '', employee: '', last_cleaned_at: '', equipment_id: null, manufacturer: '', current_description: '' }));
    jest.mocked(statistics.getPcCleaningRemaining).mockResolvedValue({ branch: 'Audit', period_days: 30, start_date: '', end_date: '', remaining_pcs: rows, remaining_pc: count, total_pc: count });
    const view = await render(<NativePcRemainingSheet visible branchRow={{ branch: 'Audit', remaining_pc: count, total_pc: count, remaining_pcs: [], cleaned_pc: 0, coverage_percent: 0, cleanings_total: 0, cleanings_period: 0 }} periodDays={30} canWrite={false} onClose={() => {}} onCleaningSaved={() => {}} />);
    await waitFor(() => expect(view.getAllByTestId(/^native-remaining-row-/).length).toBe(12));
  });
});

it('discards administrative rows on background and reloads on resume', async () => {
  const listeners: Array<(state: AppStateStatus) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: () => {} };
  });
  jest.mocked(sessions.listSessions).mockResolvedValue([{ session_id: 'audit', user_id: 1, username: 'audit-sensitive-row' }]);
  const view = await render(<NativeAdminSessionsScreen />);
  await view.findByText('audit-sensitive-row');
  await act(async () => listeners.forEach(listener => listener('background')));
  expect(view.queryByText('audit-sensitive-row')).toBeNull();
  await act(async () => listeners.forEach(listener => listener('active')));
  await view.findByText('audit-sensitive-row');
  expect(sessions.listSessions).toHaveBeenCalledTimes(2);
});

it('does not execute a stale session confirmation after leaving the online lifecycle', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(sessions.listSessions).mockResolvedValue([{ session_id: 'audit', user_id: 1, username: 'audit-sensitive-row', status: 'active' }]);
  const view = await render(<NativeAdminSessionsScreen />);
  await view.findByText('audit-sensitive-row');
  await act(async () => { fireEvent.press(view.getByText('Завершить')); });
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Завершить');
  expect(confirm).toBeTruthy();
  mockOffline = true;
  await view.rerender(<NativeAdminSessionsScreen />);
  await act(async () => { confirm?.onPress?.(); });
  expect(sessions.terminateSession).not.toHaveBeenCalled();
});

it('does not request or clean PCs while offline', async () => {
  mockOffline = true;
  const row = { inv_no: 'audit-pc', serial_no: 'serial', hw_serial_no: '', location: '', model_name: '', employee: '', last_cleaned_at: '', equipment_id: null, manufacturer: '', current_description: '' };
  const view = await render(<NativePcRemainingSheet visible branchRow={{ branch: 'Audit', remaining_pc: 1, total_pc: 1, remaining_pcs: [row], cleaned_pc: 0, coverage_percent: 0, cleanings_total: 0, cleanings_period: 0 }} periodDays={30} canWrite onClose={() => {}} onCleaningSaved={() => {}} />);
  await view.findByTestId('native-remaining-row-0');
  await act(async () => { fireEvent.press(view.getByTestId('native-remaining-clean-0')); });
  expect(statistics.getPcCleaningRemaining).not.toHaveBeenCalled();
  expect(statistics.addPcCleaningRecord).not.toHaveBeenCalled();
  expect(view.queryByTestId('native-remaining-confirm')).toBeNull();
});
