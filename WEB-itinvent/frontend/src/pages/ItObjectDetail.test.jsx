import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const { api, passwordsApi } = vi.hoisted(() => ({
  passwordsApi: { getEntries: vi.fn() },
  api: {
    get: vi.fn(),
    computers: vi.fn(),
    inventory: vi.fn(),
    passwordsAudit: vi.fn(),
    userOptions: vi.fn(),
    assignOwner: vi.fn(),
    clearOwner: vi.fn(),
    grant: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../api/itObjects', () => ({ itObjectsAPI: api }));
vi.mock('../api/passwords', () => ({ passwordsAPI: passwordsApi }));

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
    passwordsApi.getEntries.mockReset();
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

  it('shows the passwords tab only with a passwords grant and lists the object entries', async () => {
    api.get.mockResolvedValue({
      ...adminView,
      my_access: { is_owner: false, sections: { passwords: 'view' } },
      can_manage_grants: false,
    });
    passwordsApi.getEntries.mockResolvedValue({ items: [{ id: 'e1', login: 'rega-admin', group: 'Серверы', description: 'Консоль' }] });
    renderPage('?tab=passwords');

    expect(await screen.findByText('rega-admin')).toBeTruthy();
    expect(passwordsApi.getEntries).toHaveBeenCalledWith({ object_ref: OBJECT_REF, limit: 100 });
    expect(screen.getByRole('link', { name: 'Открыть в разделе «Пароли»' }).getAttribute('href'))
      .toBe(`/passwords?object=${encodeURIComponent(OBJECT_REF)}`);

    api.get.mockResolvedValue({ ...adminView, can_manage_grants: false });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Пароли' })).toBeNull());
  });

  it('shows the passwords journal to managers only', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: true, sections: { passwords: 'manage' } }, can_manage_grants: true });
    passwordsApi.getEntries.mockResolvedValue({ items: [] });
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
    expect(await screen.findByText('Паролей у этого объекта пока нет.')).toBeTruthy();
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

  it('lists the object inventory and loads the next page on demand', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { inventory: 'view' } }, can_manage_grants: false });
    api.inventory
      .mockResolvedValueOnce({ items: [{ id: 1, inv_no: '4711', type_name: 'Монитор', model_name: 'Dell P2422', status: 'В эксплуатации' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: 2, inv_no: '4712', type_name: 'Принтер', model_name: 'HP M404' }], total: 2 });
    renderPage('?tab=inventory');

    expect(await screen.findByText('Монитор · Dell P2422')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Компьютеры' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

    expect(await screen.findByText('Принтер · HP M404')).toBeTruthy();
    expect(screen.getByText('Монитор · Dell P2422')).toBeTruthy();
    expect(api.inventory).toHaveBeenLastCalledWith(OBJECT_REF, expect.objectContaining({ page: 2 }));
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('shows the refusal instead of the list when the section is not granted', async () => {
    api.get.mockResolvedValue({ ...adminView, my_access: { is_owner: false, sections: { computers: 'view' } }, can_manage_grants: false });
    api.computers.mockRejectedValue({ response: { status: 403, data: { detail: 'Раздел «Компьютеры» этого объекта вам не выдан' } } });
    renderPage('?tab=computers');

    expect(await screen.findByText(/Компьютеры» этого объекта вам не выдан/)).toBeTruthy();
  });
});
