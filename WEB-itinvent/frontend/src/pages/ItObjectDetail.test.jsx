import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const { api, databaseApi, settingsApi, passwordsApi, navigate, auth } = vi.hoisted(() => ({
  passwordsApi: { getEntries: vi.fn(), revealEntry: vi.fn() },
  databaseApi: { switchDatabase: vi.fn() },
  settingsApi: { updateMySettings: vi.fn() },
  navigate: vi.fn(),
  auth: { user: { role: 'admin', username: 'admin', is_2fa_enabled: true }, hasPermission: () => true, refreshSession: vi.fn() },
  api: {
    get: vi.fn(),
    computers: vi.fn(),
    computer: vi.fn(),
    setTeam: vi.fn(),
    searchEmployees: vi.fn(),
    inventory: vi.fn(),
    passwordsAudit: vi.fn(),
    userOptions: vi.fn(),
    assignOwner: vi.fn(),
    clearOwner: vi.fn(),
    setAccess: vi.fn(),
    hide: vi.fn(),
    restore: vi.fn(),
    monitoring: vi.fn(),
    monitoringFreeDevices: vi.fn(),
    assignMonitoringDevice: vi.fn(),
    releaseMonitoringDevice: vi.fn(),
  },
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../api/itObjects', () => ({ itObjectsAPI: api }));
vi.mock('../api/database', () => ({ databaseAPI: databaseApi }));
vi.mock('../api/settings', () => ({ settingsAPI: settingsApi }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => navigate }));
vi.mock('../api/passwords', () => ({ passwordsAPI: passwordsApi }));
vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({ notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(), notifyApiError: vi.fn() }),
}));
vi.mock('../lib/useWebAuthnAvailability', () => ({ useWebAuthnAvailability: () => ({ webAuthnReady: false }) }));

import ItObjectDetail from './ItObjectDetail';


const OBJECT_REF = 'OBJ-ITINVENT:12';

const adminView = {
  object_ref: OBJECT_REF,
  name: 'Объект Альфа',
  owner: null,
  my_access: { is_owner: false, sections: {} },
  can_manage_owner: true,
  can_manage_grants: true,
  grants: [],
};

function renderPage(search = '') {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[`/it/objects/${encodeURIComponent(OBJECT_REF)}${search}`]}>
        <Routes>
          <Route path="/it/objects/:objectRef" element={<ItObjectDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ItObjectDetail', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.userOptions.mockResolvedValue({ items: [{ id: 5, username: 'ivan', full_name: 'Иван Петров', job_title: 'Системный администратор' }] });
    api.assignOwner.mockResolvedValue({ object_ref: OBJECT_REF });
  });

  it('lets an admin pick the IT owner from the user list and shows them after the reload', async () => {
    api.get
      .mockResolvedValueOnce(adminView)
      .mockResolvedValue({ ...adminView, owner: { user_id: 5, user_name: 'Иван Петров' } });
    renderPage('?tab=structure');

    const picker = await screen.findByLabelText('Назначить айтишника');
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: 'Иван' } });
    fireEvent.click(await screen.findByRole('option', { name: /Иван Петров/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(api.assignOwner).toHaveBeenCalledWith(OBJECT_REF, 5));
    expect(await screen.findByText('Иван Петров', { selector: 'p' })).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('shows the object team with its history and lets an admin assign a role from the ZUP directory', async () => {
    const withTeam = {
      ...adminView,
      team: [{ role_key: 'pto_manager', employee_code: 'Z1', full_name: 'Иванов Иван', position: 'Инженер ПТО', department: 'ПТО', department_location: '' }],
      team_history: [{ role_key: 'pto_manager', employee_code: 'Z0', full_name: 'Смирнов Семён', valid_from: '2026-01-10T00:00:00Z', valid_to: '2026-06-01T00:00:00Z' }],
    };
    api.get.mockResolvedValue(withTeam);
    api.setTeam.mockResolvedValue({ object_ref: OBJECT_REF });
    api.searchEmployees.mockResolvedValue({ items: [{ employee_code: 'Z7', full_name: 'Орлов Олег', position: 'ГИП', department: 'Проектный отдел', department_location: '' }] });
    renderPage('?tab=structure');

    expect(await screen.findByText('Команда объекта')).toBeTruthy();
    expect(screen.getByText('Иванов Иван')).toBeTruthy();
    expect(screen.getByText('Инженер ПТО · ПТО')).toBeTruthy();
    ['Руководитель проекта', 'Координатор УМТО', 'ГИП — главный инженер проекта'].forEach((role) => expect(screen.getAllByText(role).length).toBeGreaterThan(0));
    expect(screen.getByText('Смирнов Семён')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Сохранить' }).disabled).toBe(true);
    const picker = dialog.getByLabelText('ГИП — главный инженер проекта');
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: 'Орлов' } });
    fireEvent.click(await screen.findByRole('option', { name: /Орлов Олег/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(api.setTeam).toHaveBeenCalledTimes(1));
    expect(api.setTeam).toHaveBeenCalledWith(OBJECT_REF, {
      chief_project_engineer: { employee_code: 'Z7', full_name: 'Орлов Олег', position: 'ГИП', department: 'Проектный отдел', department_location: '' },
    });
    expect(api.searchEmployees).toHaveBeenCalledWith('Орлов', expect.objectContaining({ limit: 30 }));
  });

  it('shows the team to a colleague but without the edit button and the history', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { passwords: 'view' } },
      can_manage_owner: false,
      can_manage_grants: false,
      team: [{ role_key: 'umto_coordinator', employee_code: 'Z2', full_name: 'Кузнецова Анна', position: 'Снабженец', department: '' }],
      team_history: [],
    });
    renderPage('?tab=structure');

    expect(await screen.findByText('Кузнецова Анна')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.queryByText('История назначений')).toBeNull();
  });

  it('shows a colleague only their own access: no assignment form and no access tab', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      owner: { user_id: 2, user_name: 'Пётр Сидоров' },
      my_access: { is_owner: false, sections: { passwords: 'view' } },
      can_manage_owner: false,
      can_manage_grants: false,
    });
    renderPage();

    expect(await screen.findByText('Пароли: Просмотр')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Доступ' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Структура' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Структура' }));
    expect(await screen.findByText('Пётр Сидоров')).toBeTruthy();
    expect(screen.queryByLabelText('Назначить айтишника')).toBeNull();
  });

  it('groups grants into one row per person and saves all their sections in one call', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      owner: { user_id: 2, user_name: 'Пётр Сидоров' },
      grants: [
        { user_id: 7, user_name: 'Анна Волкова', section: 'passwords', level: 'view' },
        { user_id: 7, user_name: 'Анна Волкова', section: 'inventory', level: 'manage' },
      ],
    });
    api.setAccess.mockResolvedValue({ object_ref: OBJECT_REF });
    renderPage('?tab=access');

    expect(await screen.findByText('Анна Волкова')).toBeTruthy();
    expect(screen.getAllByText('Анна Волкова')).toHaveLength(1);
    expect(screen.getByText('Айтишник — все разделы')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();

    // Каждая строка: свой набор выборов, поэтому у Анны «Компьютеры» — «Нет доступа».
    const computers = screen.getAllByLabelText('Компьютеры');
    fireEvent.mouseDown(computers[computers.length - 1]);
    fireEvent.click(await screen.findByRole('option', { name: 'Просмотр' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(api.setAccess).toHaveBeenCalledTimes(1));
    expect(api.setAccess).toHaveBeenCalledWith(OBJECT_REF, 7, { passwords: 'view', computers: 'view', inventory: 'manage', monitoring: null });
  });

  it('gives a new person a whole preset at once and can take all access away in one click', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      grants: [{ user_id: 7, user_name: 'Анна Волкова', section: 'passwords', level: 'view' }],
    });
    api.setAccess.mockResolvedValue({ object_ref: OBJECT_REF });
    renderPage('?tab=access');

    const picker = await screen.findByLabelText('Сотрудник');
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: 'Иван' } });
    fireEvent.click(await screen.findByRole('option', { name: /Иван Петров/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Управление всем' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    await waitFor(() => expect(api.setAccess).toHaveBeenCalledWith(OBJECT_REF, 5, { passwords: 'manage', computers: 'manage', inventory: 'manage', monitoring: 'manage' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Забрать весь доступ: Анна Волкова' }));
    await waitFor(() => expect(api.setAccess).toHaveBeenLastCalledWith(OBJECT_REF, 7, { passwords: null, computers: null, inventory: null, monitoring: null }));
  });

  it('lets an admin delete an object from the structure tab and restore a deleted one from its card', async () => {
    api.get.mockResolvedValue(adminView);
    api.hide.mockResolvedValue({ object_ref: OBJECT_REF });
    renderPage('?tab=structure');

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить объект' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.hide).toHaveBeenCalledWith(OBJECT_REF));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/it/objects'));
  });

  it('shows a deleted object with a restore button and an unlinked one without inventory sections', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      hidden: true,
      linked: false,
      custom: true,
      my_access: { is_owner: true, sections: { passwords: 'manage', computers: 'manage', inventory: 'manage' } },
    });
    api.restore.mockResolvedValue({ object_ref: OBJECT_REF });
    renderPage();

    expect(await screen.findByText(/Объект удалён/)).toBeTruthy();
    expect(screen.getByText(/не привязан к филиалу ITINVENT/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Пароли' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Компьютеры' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Инвентарь' })).toBeNull();

    api.get.mockResolvedValue({ ...adminView, linked: false, custom: true });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith(OBJECT_REF));
    await waitFor(() => expect(screen.queryByText(/Объект удалён/)).toBeNull());
  });

  it('lists only this object passwords with view and copy, and leaves editing to the passwords section', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { passwords: 'view' } },
      can_manage_grants: false,
    });
    passwordsApi.getEntries.mockResolvedValue({ items: [{ id: 'e1', login: 'rega-admin', group: 'Серверы', description: 'Консоль', password_configured: true }] });
    renderPage('?tab=passwords');

    expect((await screen.findAllByText('rega-admin')).length).toBeGreaterThan(0);
    expect(passwordsApi.getEntries).toHaveBeenCalledWith({ object_ref: OBJECT_REF, limit: 100 });
    expect(screen.getByRole('button', { name: 'Показать пароль rega-admin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скопировать пароль rega-admin' })).toBeTruthy();
    expect(screen.queryByText('Новая запись')).toBeNull();
    expect(screen.queryByText('Группы')).toBeNull();
    expect(screen.getByRole('link', { name: 'Открыть в разделе «Пароли»' }).getAttribute('href'))
      .toBe(`/passwords?object=${encodeURIComponent(OBJECT_REF)}`);

    api.get.mockResolvedValue({ ...adminView, can_manage_grants: false });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Пароли' })).toBeNull());
  });

  it('asks for the second factor when the vault is locked', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { passwords: 'view' } }, can_manage_grants: false });
    passwordsApi.getEntries.mockResolvedValue({ items: [{ id: 'e1', login: 'rega-admin', group: 'Серверы', password_configured: true }] });
    passwordsApi.revealEntry.mockRejectedValueOnce({ response: { status: 403, data: { detail: 'Password vault unlock is required' } } });
    renderPage('?tab=passwords');

    fireEvent.click(await screen.findByRole('button', { name: 'Показать пароль rega-admin' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(passwordsApi.revealEntry).toHaveBeenCalledWith('e1', { purpose: 'show' });
    expect(screen.queryByText('S3cret!')).toBeNull();
  });

  it('shows the revealed password and reloads the managers journal after it', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: true, sections: { passwords: 'manage' } }, can_manage_grants: true });
    passwordsApi.getEntries.mockResolvedValue({ items: [{ id: 'e1', login: 'rega-admin', group: 'Серверы', password_configured: true }] });
    api.passwordsAudit.mockResolvedValue({ items: [] });
    passwordsApi.revealEntry.mockResolvedValue({ password: 'S3cret!', unlocked_until: new Date(Date.now() + 300000).toISOString() });
    renderPage('?tab=passwords');

    fireEvent.click(await screen.findByRole('button', { name: 'Показать пароль rega-admin' }));

    expect(await screen.findByText('S3cret!')).toBeTruthy();
    await waitFor(() => expect(api.passwordsAudit).toHaveBeenCalledTimes(2));
  });

  it('shows the passwords journal to managers only', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: true, sections: { passwords: 'manage' } }, can_manage_grants: true });
    passwordsApi.getEntries.mockResolvedValue({ items: [{ id: 'e1', login: 'rega-admin', group: 'Серверы', password_configured: true }] });
    api.passwordsAudit.mockResolvedValue({
      items: [{ id: 1, action: 'reveal.show', actor_username: 'colleague_user', entry_login: 'rega-admin', created_at: '2026-10-28T10:00:00+00:00' }],
    });
    const { unmount } = renderPage('?tab=passwords');
    expect(await screen.findByText(/открыл\(а\) пароль/)).toBeTruthy();
    expect(api.passwordsAudit).toHaveBeenCalledTimes(1);
    unmount();

    api.passwordsAudit.mockClear();
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { passwords: 'view' } }, can_manage_grants: false });
    renderPage('?tab=passwords');
    expect((await screen.findAllByText('rega-admin')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Журнал: кто работал/)).toBeNull();
    expect(api.passwordsAudit).not.toHaveBeenCalled();
  });

  it('lists the object computers on the computers tab only when that section is granted', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { computers: 'view' } },
      can_manage_grants: false,
    });
    api.computers.mockResolvedValue({
      items: [{ mac_address: 'AA', hostname: 'PC-ALPHA-1', status: 'online', user_full_name: 'Иван Петров', ip_primary: '10.0.0.5', inventory_inv_no: '4711' }],
    });
    renderPage('?tab=computers');

    expect(await screen.findByText('PC-ALPHA-1')).toBeTruthy();
    expect(api.computers).toHaveBeenCalledWith(OBJECT_REF, expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByText('В сети')).toBeTruthy();
    expect(screen.getByText('Инв. 4711')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Пароли' })).toBeNull();
  });

  it('opens the full computer card with a way back for those who may use the Computers page', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { computers: 'view' } }, can_manage_grants: false });
    api.computers.mockResolvedValue({ items: [{ mac_address: 'AA-BB', hostname: 'PC-ALPHA-1', status: 'online' }] });
    renderPage('?tab=computers');

    navigate.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть компьютер PC-ALPHA-1' }));

    expect(api.computer).not.toHaveBeenCalled();
    const [target] = navigate.mock.calls[0];
    const params = new URLSearchParams(target.split('?')[1]);
    expect(target.startsWith('/computers?')).toBe(true);
    expect(params.get('open')).toBe('AA-BB');
    expect(params.get('q')).toBe('PC-ALPHA-1');
    expect(params.get('back')).toBe(`/it/objects/${encodeURIComponent(OBJECT_REF)}?tab=computers`);
  });

  it('opens a computer of the object in a window with its hardware for those without the Computers page', async () => {
    const { user, hasPermission } = auth;
    auth.user = { role: 'operator', username: 'op' };
    auth.hasPermission = () => false;
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { computers: 'view' } }, can_manage_grants: false });
    api.computers.mockResolvedValue({ items: [{ mac_address: 'AA-BB', hostname: 'PC-ALPHA-1', status: 'online', user_full_name: 'Иван Петров', ip_primary: '10.0.0.5' }] });
    api.computer.mockResolvedValue({
      mac_address: 'AA-BB',
      cpu_model: 'Intel Core i5',
      ram_gb: 16,
      uptime_seconds: 93600,
      logical_disks: [{ mountpoint: 'C:', total_gb: 237, free_gb: 90 }],
      network: { devices: [{ name: 'Ethernet', ipv4: ['10.0.0.5'], connection_status: 'Up' }] },
    });
    renderPage('?tab=computers');

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть компьютер PC-ALPHA-1' }));

    expect(await screen.findByText('Intel Core i5')).toBeTruthy();
    expect(api.computer).toHaveBeenCalledWith(OBJECT_REF, 'AA-BB', expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByText('C: — свободно 90 из 237 ГБ')).toBeTruthy();
    expect(screen.getByText('1 д 2 ч')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('Иван Петров')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Полная карточка' })).toBeNull();
    Object.assign(auth, { user, hasPermission });
  });

  it('shows the list data and the reason when the computer detail cannot be loaded', async () => {
    const { user, hasPermission } = auth;
    auth.user = { role: 'operator', username: 'op' };
    auth.hasPermission = () => false;
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { computers: 'view' } }, can_manage_grants: false });
    api.computers.mockResolvedValue({ items: [{ mac_address: 'AA-BB', hostname: 'PC-ALPHA-1', status: 'offline', user_full_name: 'Иван Петров' }] });
    api.computer.mockRejectedValue({ response: { status: 404, data: { detail: 'Компьютер не найден на этом объекте' } } });
    renderPage('?tab=computers');

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть компьютер PC-ALPHA-1' }));

    expect(await screen.findByText(/Компьютер не найден на этом объекте/)).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('Иван Петров')).toBeTruthy();
    Object.assign(auth, { user, hasPermission });
  });

  it('shows the whole object inventory in the inventory table, searchable, with a card on row click', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { inventory: 'view' } }, can_manage_grants: false });
    api.inventory
      .mockResolvedValueOnce({
        items: [{ id: 1, inv_no: '4711', serial_no: 'SN-4711', type_name: 'Монитор', model_name: 'Dell P2422', status: 'В эксплуатации', employee_name: 'Иван Петров' }],
        total: 2,
      })
      .mockResolvedValueOnce({ items: [{ id: 2, inv_no: '4712', type_name: 'Принтер', model_name: 'HP M404', employee_name: 'Анна Сидорова' }], total: 2 });
    renderPage('?tab=inventory');

    expect(await screen.findByText('Dell P2422')).toBeTruthy();
    expect(await screen.findByText('HP M404')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Компьютеры' })).toBeNull();
    expect(api.inventory).toHaveBeenLastCalledWith(OBJECT_REF, expect.objectContaining({ page: 2 }));
    expect(screen.getByText('Всего оборудования: 2')).toBeTruthy();
    expect(screen.getByText(/только просмотр/i)).toBeTruthy();
    ['1С', 'Акт', 'Фото'].forEach((name) => expect(screen.queryByRole('columnheader', { name })).toBeNull());
    expect(screen.getByRole('columnheader', { name: /Статус/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'сидорова' } });
    expect(screen.queryByText('Dell P2422')).toBeNull();
    expect(screen.getByText('HP M404')).toBeTruthy();
    expect(screen.getByText('Найдено 1 из 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'SN-4711' } });
    fireEvent.click(screen.getByText('Dell P2422'));
    expect(await screen.findByText('Серийный №')).toBeTruthy();
  });

  it('opens the full inventory on the objects database and branch, only for those who may use it', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { inventory: 'view' } }, can_manage_grants: false });
    api.inventory.mockResolvedValue({ items: [{ id: 1, inv_no: '4711', type_name: 'Монитор', model_name: 'Dell P2422' }], total: 1, database_id: 'OBJ-ITINVENT', branch_name: 'Объект  Альфа' });
    databaseApi.switchDatabase.mockResolvedValue({});
    settingsApi.updateMySettings.mockResolvedValue({});
    const { unmount } = renderPage('?tab=inventory');

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть в Инвентаре' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/database'));
    expect(databaseApi.switchDatabase).toHaveBeenCalledWith('OBJ-ITINVENT');
    expect(settingsApi.updateMySettings).toHaveBeenCalledWith({ database_branch_filters: { 'OBJ-ITINVENT': 'Объект  Альфа' } });
    expect(JSON.parse(localStorage.getItem('database_branch_filters'))['OBJ-ITINVENT']).toBe('Объект  Альфа');
    unmount();

    auth.user = { role: 'user' };
    auth.hasPermission = () => false;
    renderPage('?tab=inventory');
    expect(await screen.findByText('Dell P2422')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть в Инвентаре' })).toBeNull();
    auth.user = { role: 'admin' };
    auth.hasPermission = () => true;
  });

  it('shows the devices bound to the object on the monitoring tab and opens one in the monitoring page', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { monitoring: 'view' } },
      can_manage_grants: false,
    });
    api.monitoring.mockResolvedValue({
      object_ref: OBJECT_REF,
      targets: [{ id: 'dev-1', name: 'Router alpha', address: '10.0.0.1', port: 161, current: {}, summary: { points: [] } }],
    });
    renderPage('?tab=monitoring');

    expect(await screen.findByText('Устройства объекта · 1')).toBeTruthy();
    expect(api.monitoring).toHaveBeenCalledWith(OBJECT_REF, expect.objectContaining({ signal: expect.anything() }));
    fireEvent.click(screen.getByRole('button', { name: /Открыть .*Router alpha/ }));
    expect(navigate).toHaveBeenCalledWith(`/monitoring?object=${encodeURIComponent(OBJECT_REF)}&device=dev-1`);
    expect(screen.queryByRole('tab', { name: 'Пароли' })).toBeNull();
  });

  it('lets a monitoring manager add a free device to the object and remove an attached one', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: true, sections: { monitoring: 'manage' } },
      can_manage_grants: false,
    });
    const router = { id: 'dev-1', name: 'Router alpha', address: '10.0.0.1', port: 161, current: {}, summary: { points: [] } };
    api.monitoring.mockResolvedValueOnce({ targets: [router] }).mockResolvedValue({ targets: [] });
    api.monitoringFreeDevices.mockResolvedValue({ items: [{ id: 'dev-2', name: 'Router beta', address: '10.0.0.2' }] });
    api.assignMonitoringDevice.mockResolvedValue({});
    api.releaseMonitoringDevice.mockResolvedValue({});
    renderPage('?tab=monitoring');

    fireEvent.click(await screen.findByRole('button', { name: 'Устройства объекта' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать Router alpha' }));
    await waitFor(() => expect(api.releaseMonitoringDevice).toHaveBeenCalledWith(OBJECT_REF, 'dev-1'));

    const picker = await screen.findByLabelText('Добавить устройство');
    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByRole('option', { name: /Router beta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(api.assignMonitoringDevice).toHaveBeenCalledWith(OBJECT_REF, 'dev-2'));
  });

  it('hides device management from a monitoring viewer', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { monitoring: 'view' } }, can_manage_grants: false });
    api.monitoring.mockResolvedValue({ targets: [] });
    renderPage('?tab=monitoring');

    expect(await screen.findByText('Устройства объекта · 0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Устройства объекта' })).toBeNull();
  });

  it('summarises only the granted sections on the overview and opens a section from its tile', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { computers: 'view', inventory: 'view', monitoring: 'view' } },
      can_manage_grants: false,
    });
    api.computers.mockResolvedValue({ items: [{ mac_address: 'AA', status: 'online' }, { mac_address: 'BB', status: 'offline' }] });
    api.inventory.mockResolvedValue({ items: [{ id: 1 }], total: 37 });
    api.monitoring.mockResolvedValue({
      targets: [
        { id: 'a', name: 'Router alpha', enabled: true, current: { status: 'offline', checked_at: new Date().toISOString() } },
        { id: 'b', name: 'Router beta', enabled: true, current: { status: 'ok', snmp_status: 'ok', checked_at: new Date().toISOString() } },
      ],
    });
    passwordsApi.getEntries.mockClear();
    renderPage();

    expect(await screen.findByText('37')).toBeTruthy();
    expect(await screen.findByText('в сети: 1')).toBeTruthy();
    expect(await screen.findByText('проблемы: 1')).toBeTruthy();
    expect(passwordsApi.getEntries).not.toHaveBeenCalled();
    expect(api.inventory).toHaveBeenCalledWith(OBJECT_REF, expect.objectContaining({ limit: 1 }));

    fireEvent.click(screen.getByRole('button', { name: 'Открыть раздел Мониторинг' }));
    expect(await screen.findByText('Устройства объекта · 2')).toBeTruthy();
  });

  it('shows the refusal instead of the list when the section is not granted', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { computers: 'view' } }, can_manage_grants: false });
    api.computers.mockRejectedValue({ response: { status: 403, data: { detail: 'Раздел «Компьютеры» этого объекта вам не выдан' } } });
    renderPage('?tab=computers');

    expect(await screen.findByText(/Компьютеры» этого объекта вам не выдан/)).toBeTruthy();
  });
});
