import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import ConstructionWorkPanel from './ConstructionWorkPanel';
import ConstructionWorkCharts from './ConstructionWorkCharts';
import { emptyWorkPlan, localWorkDate } from './constructionWorkUtils';

const { api, permission } = vi.hoisted(() => ({
  api: { read: vi.fn(), saveDay: vi.fn(), savePlan: vi.fn(), history: vi.fn() },
  permission: vi.fn(),
}));
vi.mock('../../api/constructionWork', () => ({ constructionWorkAPI: api }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: permission }) }));

const item = {
  id: '33333333-3333-3333-3333-333333333333', version: 4, group_ref: 'group',
  plan: { ...emptyWorkPlan(), section: 'ЭОМ', name: 'Кабель', unit: 'м', planned_quantity: '1000', weight: '1' },
  day: { quantity: '20', engineers: 1, installers: 3, comment: '' },
  total_quantity: 500, remaining_quantity: 500, percent: 50, overdue: false,
};
const response = () => ({
  as_of: localWorkDate(), items: [structuredClone(item)],
  summary: { total: 1, completed: 0, overdue: 0, over_plan: 0, percent: 50 },
  sections: [{ name: 'ЭОМ', group_ref: 'group', percent: 50 }], directions: [],
  trend: [{ date: '2026-08-01', percent: 10 }, { date: '2026-09-01', percent: 50 }],
});

beforeEach(() => {
  vi.clearAllMocks(); permission.mockReturnValue(true);
  api.read.mockImplementation(async () => response());
  api.saveDay.mockResolvedValue({ saved: 1 }); api.savePlan.mockResolvedValue({ saved: 1 });
});

describe('ConstructionWorkPanel', () => {
  it('opens complete imported notes without requiring edit permission', async () => {
    permission.mockReturnValue(false);
    const text = 'Полный комментарий из Сводного. '.repeat(40);
    api.read.mockResolvedValue({ ...response(), items: [{ ...item, plan: { ...item.plan, production_comment: text } }] });
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть Производство: Кабель' }));
    const dialog = screen.getByRole('dialog', { name: 'Производство: Кабель' });
    expect(within(dialog).getByText(text.trim())).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('slider', { name: 'Положение горизонтальной прокрутки' })).toBeInTheDocument();
  });

  it('saves absolute daily values with the original version and protects the selected date', async () => {
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    const quantity = await screen.findByLabelText('За смену: Кабель');
    fireEvent.change(quantity, { target: { value: '35.5' } });
    expect(screen.getByLabelText('Дата учёта')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить за/ }));
    await waitFor(() => expect(api.saveDay).toHaveBeenCalledWith('object', 'group', localWorkDate(), [{
      id: item.id, expected_version: 4, quantity: '35.5', engineers: 1, installers: 3, comment: '',
    }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Сохранить за/ })).not.toBeInTheDocument());
  });

  it('retains typed values on conflict and only discards them explicitly', async () => {
    api.saveDay.mockRejectedValue({ response: { status: 409, data: { detail: 'Работу уже изменил другой сотрудник' } } });
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.change(await screen.findByLabelText('За смену: Кабель'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить за/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('другой сотрудник');
    expect(screen.getByLabelText('За смену: Кабель')).toHaveValue(42);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить правки' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Продолжить ввод' }));
    expect(screen.getByLabelText('За смену: Кабель')).toHaveValue(42);
  });

  it('lets the user correct invalid input after a rejected save', async () => {
    api.saveDay.mockRejectedValueOnce({ response: { status: 422, data: { detail: [] } } });
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.change(await screen.findByLabelText('За смену: Кабель'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить за/ }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('За смену: Кабель')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('За смену: Кабель'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить за/ }));
    await waitFor(() => expect(api.saveDay).toHaveBeenLastCalledWith('object', 'group', localWorkDate(), [expect.objectContaining({ quantity: '40' })]));
  });

  it('asks before discarding input on a route change and can stay or leave', async () => {
    render(<MemoryRouter initialEntries={['/work']}><Routes>
      <Route path="/work" element={<><Link to="/other">К объектам</Link><ConstructionWorkPanel objectId="object" groupRef="group" /></>} />
      <Route path="/other" element={<h1>Объекты</h1>} />
    </Routes></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('За смену: Кабель'), { target: { value: '77' } });
    fireEvent.click(screen.getByRole('link', { name: 'К объектам' }));
    expect(await screen.findByRole('dialog', { name: 'В таблице остались несохранённые изменения' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Остаться в таблице' }));
    expect(screen.getByLabelText('За смену: Кабель')).toHaveValue(77);
    fireEvent.click(await screen.findByRole('link', { name: 'К объектам' }));
    fireEvent.click(screen.getByRole('button', { name: 'Уйти без сохранения' }));
    expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument();
  });

  it('does not expose edit controls to a reader', async () => {
    permission.mockReturnValue(false);
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    expect(await screen.findByText('Кабель')).toBeInTheDocument();
    expect(screen.queryByLabelText('За смену: Кабель')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить работу' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'История' })).toBeInTheDocument();
  });

  it('saves a native plan without Excel and preserves its version', async () => {
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.click(await screen.findByRole('button', { name: 'План' }));
    fireEvent.change(screen.getByLabelText('Плановый объём', { exact: false }), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить план' }));
    await waitFor(() => expect(api.savePlan).toHaveBeenCalledWith('object', 'group', [expect.objectContaining({
      id: item.id, expected_version: 4, plan: expect.objectContaining({ planned_quantity: '1500' }),
    })]));
  });

  it('keeps a daily draft when hidden and shown and does not fetch hidden panes', async () => {
    const { rerender } = render(<ConstructionWorkPanel objectId="object" groupRef="group" active={false} />);
    expect(api.read).not.toHaveBeenCalled();
    rerender(<ConstructionWorkPanel objectId="object" groupRef="group" active />);
    fireEvent.change(await screen.findByLabelText('За смену: Кабель'), { target: { value: '55' } });
    rerender(<ConstructionWorkPanel objectId="object" groupRef="group" active={false} />);
    rerender(<ConstructionWorkPanel objectId="object" groupRef="group" active />);
    expect(screen.getByLabelText('За смену: Кабель')).toHaveValue(55);
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('finishes a pending refresh across tab switches without disabling the journal forever', async () => {
    let finishRefresh;
    const { rerender } = render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    await screen.findByLabelText('За смену: Кабель');
    api.read.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить таблицу' }));
    rerender(<ConstructionWorkPanel objectId="object" groupRef="group" active={false} />);
    await act(async () => finishRefresh(response()));
    rerender(<ConstructionWorkPanel objectId="object" groupRef="group" active />);
    expect(screen.getByLabelText('За смену: Кабель')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Обновить таблицу' })).toBeEnabled();
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it('shows the renamed section after editing the final work in the selected section', async () => {
    render(<ConstructionWorkPanel objectId="object" groupRef="group" initialSection="ЭОМ" />);
    fireEvent.click(await screen.findByRole('button', { name: 'План' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Изменить план работы' }));
    fireEvent.change(dialog.getByLabelText(/Раздел/), { target: { value: 'Электромонтаж' } });
    api.read.mockResolvedValue({ ...response(), items: [{ ...item, plan: { ...item.plan, section: 'Электромонтаж' } }] });
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить план' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('За смену: Кабель')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Электромонтаж/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Раздел' })).toHaveTextContent('Все разделы');
  });

  it('preserves four decimal places for permitted small quantities', async () => {
    api.read.mockResolvedValue({ ...response(), items: [{ ...item, plan: { ...item.plan, planned_quantity: '0.0001' }, total_quantity: 0.0001, remaining_quantity: 0, percent: 100 }] });
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    await screen.findByText('Кабель');
    expect(screen.getAllByText('0,0001')).toHaveLength(2);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('archives with confirmation and restores from the archive while retaining history access', async () => {
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.click(await screen.findByRole('button', { name: 'В архив' }));
    expect(api.savePlan).not.toHaveBeenCalled();
    const archived = { ...item, version: 5, plan: { ...item.plan, archived: true } };
    api.read.mockResolvedValue({ ...response(), items: [archived] });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'В архив' }));
    await waitFor(() => expect(api.savePlan).toHaveBeenCalledWith('object', 'group', [expect.objectContaining({ expected_version: 4, plan: expect.objectContaining({ archived: true }) })]));
    await screen.findByText(/План пока пуст/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /Архив работ/ }));
    expect(screen.getByText('Кабель')).toBeInTheDocument();
    expect(screen.queryByLabelText('За смену: Кабель')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'История' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(api.savePlan).toHaveBeenLastCalledWith('object', 'group', [expect.objectContaining({ expected_version: 5, plan: expect.objectContaining({ archived: false }) })]));
  });

  it('limits actual dates to today while allowing future planned dates', async () => {
    render(<ConstructionWorkPanel objectId="object" groupRef="group" />);
    fireEvent.click(await screen.findByRole('button', { name: 'План' }));
    expect(screen.getByLabelText('Начальный объём на дату')).toHaveAttribute('max', localWorkDate());
    expect(screen.getByLabelText('Начало — факт')).toHaveAttribute('max', localWorkDate());
    expect(screen.getByLabelText('Окончание — факт')).toHaveAttribute('max', localWorkDate());
    expect(screen.getByLabelText('Окончание — план')).toHaveAttribute('max', '2100-12-31');
  });
});

describe('ConstructionWorkCharts', () => {
  it('labels the first-sheet total and shows its source sections without requesting weights', async () => {
    api.read.mockResolvedValue({ ...response(), summary: { ...response().summary, percent: 91.59707083663022,
      calculation: { source_sheet: 'ГПР-720-7 (101)', section_count: 24, included_works: 920, excluded_works: 110, missing_works: 0, notes: [] } },
      calculation_sections: [{ name: 'ЭОМ первого листа', percent: 132.49 }], trend: [] });
    render(<ConstructionWorkCharts objectId="object" groupRef="group" />);
    expect(await screen.findByText('91,6%')).toBeInTheDocument();
    expect(screen.getByText('Готовность по первому листу')).toBeInTheDocument();
    expect(screen.getByText('ЭОМ первого листа')).toBeInTheDocument();
    expect(screen.queryByText(/положительные веса всех работ/)).not.toBeInTheDocument();
    expect(screen.getByText(/остальные 110 не включены/)).toBeInTheDocument();
  });

  it('shows actual progress and opens the selected section', async () => {
    const onOpenWork = vi.fn();
    render(<ConstructionWorkCharts objectId="object" groupRef="group" onOpenWork={onOpenWork} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть ход работ: ЭОМ' }));
    expect(onOpenWork).toHaveBeenCalledWith('group', 'ЭОМ');
    expect(screen.getByRole('img', { name: 'График накопленного выполнения' })).toBeInTheDocument();
  });
  it('never fabricates zero readiness when weights are missing', async () => {
    api.read.mockResolvedValue({ ...response(), summary: { ...response().summary, percent: null }, trend: [] });
    render(<ConstructionWorkCharts objectId="object" groupRef="group" />);
    expect(await screen.findByText('Готовность не рассчитана')).toBeInTheDocument();
    expect(screen.getByText(/положительные веса всех работ/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
