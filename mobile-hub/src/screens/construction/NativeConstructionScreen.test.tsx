import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as api from '../../api/constructionApi';
import { NativeConstructionScreen } from './NativeConstructionScreen';
import { writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { nativeConstructionDestinationFromPortalPath } from '../../construction/nativeConstructionRoutes';
let mockAccess = { user: { id: 42 }, offlineMode: false, hasPermission: (permission: string): boolean => permission === 'construction.read' };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAccess }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: jest.requireActual('../../preferences/preferenceNormalizers').DEFAULT_PREFERENCES }) }));
jest.mock('../../api/constructionApi');
const page = { items: [{ object_ref: 'one', name: 'Объект Север', kind: 'project', request_count: 3 }], has_more: false, as_of: '2026-09-08' };
beforeEach(() => {
  jest.clearAllMocks();
  mockAccess = { user: { id: 42 }, offlineMode: false, hasPermission: permission => permission === 'construction.read' };
  (api.getConstructionObjects as jest.Mock).mockResolvedValue(page);
  (api.getConstructionDetail as jest.Mock).mockResolvedValue({ id: 'one', name: 'Объект Север', groups: [{ group_ref: 'direction', group_name: 'Электромонтаж' }] });
  (api.getConstructionRequests as jest.Mock).mockResolvedValue({ items: [{ request_ref: 'request', request_number: 'Заявка 100', stage: { label: 'Заказано' } }], has_more: false });
});
it('opens an object and preserves direction/request identifiers in deep links', async () => {
  const view = await render(<NativeConstructionScreen />);
  await waitFor(() => expect(view.getByText('Объект Север')).toBeTruthy());
  await fireEvent.press(view.getByText('Объект Север'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/construction', params: { objectId: 'one' } });
  expect(nativeConstructionDestinationFromPortalPath('/construction/objects/one/directions/two/requests/three')).toEqual({ pathname: '/(shell)/construction', params: { objectId: 'one', groupRef: 'two', requestRef: 'three' } });
  expect(nativeConstructionDestinationFromPortalPath('/construction/objects/%2Fsecret')).toBeNull();
});
it('does not request construction data without permission', async () => {
  mockAccess.hasPermission = () => false;
  const view = await render(<NativeConstructionScreen />);
  expect(view.getByText('Нет доступа')).toBeTruthy();
  expect(api.getConstructionObjects).not.toHaveBeenCalled();
});
it('shows directions and request details using the server contract', async () => {
  (api.getConstructionRequest as jest.Mock).mockResolvedValue({ request_ref: 'request', request_number: 'Заявка 100', item_groups: [{ name: 'Кабель', qty_requested: 10, unit: 'м' }] });
  const view = await render(<NativeConstructionScreen objectId="one" />);
  await waitFor(() => expect(view.getByText('Электромонтаж')).toBeTruthy());
  await view.rerender(<NativeConstructionScreen objectId="one" groupRef="direction" requestRef="request" />);
  await waitFor(() => expect(view.getByText('Кабель')).toBeTruthy());
  expect(api.getConstructionRequest).toHaveBeenCalledWith({ objectId: 'one', groupRef: 'direction', requestRef: 'request' }, expect.any(AbortSignal));
});
it('uses an encrypted user-scoped snapshot offline without HTTP', async () => {
  mockAccess.offlineMode = true;
  await writeNativeEntitySnapshot('construction-details', 42, JSON.stringify([undefined, undefined, undefined, '', 'active', 'project']), { page });
  const view = await render(<NativeConstructionScreen />);
  await waitFor(() => expect(view.getByText('Объект Север')).toBeTruthy());
  expect(api.getConstructionObjects).not.toHaveBeenCalled();
});
it('ignores a response from a previously opened object', async () => {
  let finish!: (value: unknown) => void;
  (api.getConstructionDetail as jest.Mock).mockImplementation((scope) => scope.objectId === 'old'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ id: 'new', name: 'Новый объект' }));
  const view = await render(<NativeConstructionScreen objectId="old" />);
  await waitFor(() => expect(api.getConstructionDetail).toHaveBeenCalled());
  await view.rerender(<NativeConstructionScreen objectId="new" />);
  await waitFor(() => expect(view.getAllByText('Новый объект').length).toBeGreaterThan(0));
  await act(async () => finish({ id: 'old', name: 'Устаревший объект' }));
  expect(view.queryByText('Устаревший объект')).toBeNull();
});

it('reuses object details while loading another request page', async()=>{
  (api.getConstructionRequests as jest.Mock).mockResolvedValueOnce({items:[{request_ref:'r1',request_number:'ROW-1'}],has_more:true,next_cursor:'p2'}).mockResolvedValueOnce({items:[{request_ref:'r2',request_number:'ROW-2'}],has_more:false});
  const view=await render(<NativeConstructionScreen objectId="one" />);
  await waitFor(()=>expect(view.getByText('ROW-1')).toBeTruthy());
  await fireEvent.press(view.getByText('Показать ещё'));
  await waitFor(()=>expect(view.getByText('ROW-2')).toBeTruthy());
  expect(view.getByText('ROW-1')).toBeTruthy();
  expect(api.getConstructionDetail).toHaveBeenCalledTimes(1);
  expect(api.getConstructionRequests).toHaveBeenCalledTimes(2);
});
