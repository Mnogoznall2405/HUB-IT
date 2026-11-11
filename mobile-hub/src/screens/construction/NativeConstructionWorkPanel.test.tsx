import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as api from '../../api/constructionApi';
import { writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { NativeConstructionScreen } from './NativeConstructionScreen';
import { constructionWorkSnapshotKey } from './NativeConstructionWorkPanel';
import { nativeConstructionDestinationFromPortalPath } from '../../construction/nativeConstructionRoutes';

let mockAccess = { user: { id: 842 }, offlineMode: false, hasPermission: (permission: string): boolean => permission === 'construction.read' };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAccess }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: jest.requireActual('../../preferences/preferenceNormalizers').DEFAULT_PREFERENCES }) }));
jest.mock('../../api/constructionApi');
const work = {
  id: 'w1', group_ref: 'g1', version: 1,
  plan: { name: 'Монтаж кабеля', section: 'Электрика', unit: 'м', planned_quantity: '100', initial_quantity: '0', planned_start: '2026-01-01', planned_end: '2026-02-01', material_comment: 'Кабель доставлен', production_comment: '', archived: false },
  day: { quantity: '5', engineers: 1, installers: 2, comment: 'Первая смена' },
  total_quantity: 25, remaining_quantity: 75, percent: 25, overdue: true,
};
const summary = { total: 1, percent: 25, completed: 0, overdue: 1, over_plan: 0, missing_weights_or_plan: 0 };
const response = { as_of: '2026-09-08', items: [work], summary, sections: [], directions: [{ ...summary, group_ref: 'g1', name: 'Направление ЭМ' }], trend: [], calculation_sections: [] };
beforeEach(() => {
  jest.clearAllMocks();
  mockAccess = { user: { id: 842 }, offlineMode: false, hasPermission: permission => permission === 'construction.read' };
  (api.getConstructionWork as jest.Mock).mockResolvedValue(response);
  (api.getConstructionDetail as jest.Mock).mockResolvedValue({ name: 'Объект' });
  (api.getConstructionRequests as jest.Mock).mockResolvedValue({ items: [], has_more: false });
});
const screen = (objectId = 'object') => <NativeConstructionScreen objectId={objectId} tab="work" />;

it('opens work from the object tab and shows server plan, fact, deadlines and daily data', async () => {
  const view = await render(<NativeConstructionScreen objectId="object" />);
  await fireEvent.press(view.getByText('Ход работ'));
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  expect(view.getByText('План: 100 м · Факт: 25 м')).toBeTruthy();
  expect(view.getByText('Плановые сроки: 01.01.2026 — 01.02.2026')).toBeTruthy();
  expect(view.getByText('Выполнение: 25% · Просрочено')).toBeTruthy();
  expect(view.getByText('ИТР: 1 · Монтажники: 2')).toBeTruthy();
  await fireEvent.press(view.getByText('Направление ЭМ'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/construction', params: { objectId: 'object', groupRef: 'g1', tab: 'work' } });
});

it('preserves work deep links and does not load request pages on the work tab', async () => {
  expect(nativeConstructionDestinationFromPortalPath('/construction/objects/o/directions/g?tab=work')?.params).toEqual({ objectId: 'o', groupRef: 'g', requestRef: undefined, tab: 'work' });
  const view = await render(screen());
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  expect(api.getConstructionRequests).not.toHaveBeenCalled();
  expect(api.getConstructionDetail).not.toHaveBeenCalled();
});

it('does not load work without read permission', async () => {
  mockAccess.hasPermission = () => false;
  const view = await render(screen());
  expect(view.getByText('Нет доступа')).toBeTruthy();
  expect(api.getConstructionWork).not.toHaveBeenCalled();
});

it('reads the selected date snapshot offline without HTTP and separates users', async () => {
  mockAccess.offlineMode = true;
  await writeNativeEntitySnapshot('construction-details', 842, constructionWorkSnapshotKey('cached', undefined, '2026-01-02', false), response);
  const view = await render(screen('cached'));
  await fireEvent.changeText(view.getByLabelText('Дата учёта'), '2026-01-02');
  await fireEvent.press(view.getByText('Показать на дату'));
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  expect(view.getByText(/Сохранённая копия/)).toBeTruthy();
  expect(api.getConstructionWork).not.toHaveBeenCalled();
  mockAccess.user = { id: 843 };
  await view.rerender(screen('cached'));
  await waitFor(() => expect(view.getByText(/Нет сохранённого хода работ/)).toBeTruthy());
  expect(view.queryByText('Монтаж кабеля')).toBeNull();
});

it('ignores a previous object response after navigation', async () => {
  let finish!: (value: unknown) => void;
  (api.getConstructionWork as jest.Mock).mockImplementation(scope => scope.objectId === 'old'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response));
  const view = await render(screen('old'));
  await waitFor(() => expect(api.getConstructionWork).toHaveBeenCalled());
  await view.rerender(screen('new'));
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  await act(async () => finish({ ...response, items: [{ ...work, plan: { ...work.plan, name: 'Чужая работа' } }] }));
  expect(view.queryByText('Чужая работа')).toBeNull();
});

it('rejects invalid dates and shows the archive separately', async () => {
  (api.getConstructionWork as jest.Mock).mockImplementation((_scope, params) => Promise.resolve({ ...response,
    items: [work, ...(params.include_archived ? [{ ...work, id: 'archived', plan: { ...work.plan, name: 'Архивная работа', archived: true } }] : [])],
  }));
  const view = await render(screen());
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Дата учёта'), '2026-02-30');
  await fireEvent.press(view.getByText('Показать на дату'));
  expect(view.getByText(/Укажите существующую дату/)).toBeTruthy();
  expect(api.getConstructionWork).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Архив работ'));
  await waitFor(() => expect(view.getByText('Архивная работа')).toBeTruthy());
  expect(view.queryByText('Монтаж кабеля')).toBeNull();
});

it('stops an outstanding online response on going offline and reloads on reconnect', async () => {
  let finish!: (value: unknown) => void;
  (api.getConstructionWork as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = await render(screen('transition'));
  await waitFor(() => expect(api.getConstructionWork).toHaveBeenCalledTimes(1));
  mockAccess.offlineMode = true;
  await view.rerender(screen('transition'));
  await waitFor(() => expect(view.getByText(/Нет сохранённого хода работ/)).toBeTruthy());
  await act(async () => finish(response));
  expect(view.queryByText('Монтаж кабеля')).toBeNull();
  mockAccess.offlineMode = false;
  await view.rerender(screen('transition'));
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
  expect(api.getConstructionWork).toHaveBeenCalledTimes(2);
});

it('reports a failed request and supports retry', async () => {
  (api.getConstructionWork as jest.Mock).mockRejectedValueOnce(new Error('Недоступно'));
  const view = await render(screen('retry'));
  await waitFor(() => expect(view.getByText('Повторить загрузку работ')).toBeTruthy());
  await fireEvent.press(view.getByText('Повторить загрузку работ'));
  await waitFor(() => expect(view.getByText('Монтаж кабеля')).toBeTruthy());
});
