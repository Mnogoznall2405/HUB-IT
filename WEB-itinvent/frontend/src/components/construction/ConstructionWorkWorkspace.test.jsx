import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ConstructionWorkWorkspace from './ConstructionWorkWorkspace';
import { emptyWorkPlan, localWorkDate } from './constructionWorkUtils';

const { api, permission } = vi.hoisted(() => ({
  api: {
    planning: vi.fn(),
    saveWeek: vi.fn(),
    saveSummary: vi.fn(),
    planningHistory: vi.fn(),
    read: vi.fn(async () => ({ as_of: localWorkDate(), items: [], sections: [], directions: [], trend: [], summary: { total: 0, completed: 0, overdue: 0, percent: null } })),
  },
  permission: vi.fn(),
}));
vi.mock('../../api/constructionWork', () => ({ constructionWorkAPI: api }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: permission }) }));
vi.mock('./ConstructionWorkPanel', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: () => <div data-testid="work-details-panel">Журнал работ</div>,
  };
});

const id = '33333333-3333-3333-3333-333333333333';
const response = () => {
  const d = new Date(`${localWorkDate()}T12:00:00`); d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  const start = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { items: [{ id, version: 3, plan: { ...emptyWorkPlan(), name: 'Кабель', section: 'ЭОМ', unit: 'м', planned_quantity: '100' }, day: { quantity: '0', engineers: 1, installers: 2, comment: '' }, total_quantity: 0, percent: 0, remaining_quantity: 100 }],
    week_start: start, week_end: start, week_version: 2, crew_version: 0, recorded_ids: [], crew_day: {}, allocated: {}, month_plans: {}, month_actual: {}, weekly_actual: {},
    plan: { targets: [{ work_id: id, quantity: '50' }], crews: [{ id: 'crew', name: 'Бригада 1', specialty: 'Электрики', available: 5, assignments: [{ id: 'assignment', name: 'ЭОМ', group_ref: 'group', work_ids: [id], required: 5, assigned: 4 }] }], comment: '' } };
};

async function openDay(expectWork = true) {
  fireEvent.click(screen.getByRole('button', { name: 'Сводка за день' }));
  if (!expectWork) {
    await waitFor(() => expect(api.planning).toHaveBeenCalled());
    return null;
  }
  return screen.findByLabelText('За день: Кабель');
}

beforeEach(() => {
  vi.clearAllMocks();
  permission.mockReturnValue(true);
  api.planning.mockImplementation(async () => response());
  api.saveWeek.mockResolvedValue({ version: 3 });
  api.saveSummary.mockResolvedValue({ saved: 1 });
});

it('opens the existing work journal by default without calling planning', async () => {
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  expect(await screen.findByTestId('work-details-panel')).toBeInTheDocument();
  expect(api.planning).not.toHaveBeenCalled();
});

it('saves zero as an explicit report together with crew attendance, preserving work versions', async () => {
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  const field = await openDay();
  expect(field).toHaveValue(null);
  fireEvent.change(field, { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Вышло: Бригада 1: ЭОМ'), { target: { value: '3' } });
  expect(screen.getByLabelText('Дата сводки')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить сводку' }));
  await waitFor(() => expect(api.saveSummary).toHaveBeenCalledWith('object', 'group', {
    work_date: localWorkDate(), expected_week_version: 2, expected_crew_version: 0,
    items: [{ id, expected_version: 3, quantity: '0', engineers: 1, installers: 2, comment: '' }],
    crews: [{ assignment_id: 'assignment', actual: '3', comment: '' }],
  }));
  expect(screen.getAllByLabelText('Вышло: Бригада 1: ЭОМ')).toHaveLength(1);
});

it('keeps the entered report on conflict', async () => {
  api.saveSummary.mockRejectedValue({ response: { status: 409, data: { detail: 'Недельный план изменён' } } });
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  fireEvent.change(await openDay(), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить сводку' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Недельный план изменён');
  expect(screen.getByLabelText('За день: Кабель')).toHaveValue(12);
});

it('edits the same work in the weekly plan and retains crew reservations', async () => {
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  await openDay();
  fireEvent.click(screen.getByRole('button', { name: 'Планирование' }));
  fireEvent.change(screen.getByLabelText('План недели: Кабель'), { target: { value: '75' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить план недели' }));
  await waitFor(() => expect(api.saveWeek).toHaveBeenCalledWith('object', 'group', expect.objectContaining({ expected_version: 2, plan: { ...response().plan, targets: [{ work_id: id, quantity: '75' }] } })));
  expect(screen.getByRole('slider', { name: 'Положение горизонтальной прокрутки' })).toBeInTheDocument();
});

it('does not allow readers to enter volumes or attendance', async () => {
  permission.mockReturnValue(false);
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  expect(await openDay()).toBeDisabled();
  expect(screen.getByLabelText('Вышло: Бригада 1: ЭОМ')).toBeDisabled();
});

it('copies last week into a draft without saving or copying daily fact', async () => {
  const previous = response();
  api.planning.mockResolvedValueOnce({ ...response(), week_version: 0, plan: { targets: [], crews: [], comment: '' } }).mockResolvedValueOnce(previous);
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  await openDay();
  fireEvent.click(screen.getByRole('button', { name: 'Планирование' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скопировать прошлую неделю' }));
  await screen.findByText(/скопирован в черновик/);
  expect(screen.getByLabelText('План недели: Кабель')).toHaveValue(50);
  expect(api.saveWeek).not.toHaveBeenCalled();
  expect(api.saveSummary).not.toHaveBeenCalled();
});

it('hides future unstarted works until all works is selected', async () => {
  const data = response(); data.plan.targets = []; data.items[0].plan.planned_start = '2100-12-31';
  api.planning.mockResolvedValue(data);
  render(<ConstructionWorkWorkspace objectId="object" groupRef="group" />);
  await openDay(false);
  await screen.findByText(/Работ по выбранному фильтру нет/);
  expect(screen.queryByLabelText('За день: Кабель')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Все работы, включая завершённые'));
  expect(screen.getByLabelText('За день: Кабель')).toBeInTheDocument();
});
