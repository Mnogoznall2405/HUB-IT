import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const { api, navigate } = vi.hoisted(() => ({
  navigate: vi.fn(),
  api: { list: vi.fn(), create: vi.fn(), hide: vi.fn(), restore: vi.fn() },
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../api/itObjects', () => ({ itObjectsAPI: api }));
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => navigate }));

import ItObjects from './ItObjects';


const alpha = { object_ref: 'OBJ-ITINVENT:12', name: 'Объект Альфа', owner: null, my_access: { is_owner: false, sections: {} }, custom: false, linked: true, hidden: false };
const beta = { ...alpha, object_ref: 'OBJ-ITINVENT:13', name: 'Объект Бета' };

function renderPage() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter><ItObjects /></MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ItObjects', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    navigate.mockReset();
  });

  it('gives no way to add or delete objects to people who may not manage them', async () => {
    api.list.mockResolvedValue({ items: [alpha], can_manage: false });
    renderPage();

    expect(await screen.findByText('Объект Альфа')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить объект' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Удалить объект/ })).toBeNull();
    expect(screen.queryByLabelText('Удалённые')).toBeNull();
  });

  it('shows a clean card: the whole card opens the object, the owner by initials, no access chips', async () => {
    const owned = { ...alpha, owner: { user_id: 5, user_name: 'Никулин Александр Сергеевич' }, my_access: { is_owner: false, sections: { passwords: 'manage', computers: 'view' } } };
    api.list.mockResolvedValue({ items: [owned, beta], can_manage: false });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Открыть объект Объект Альфа' });
    expect(link.getAttribute('href')).toBe(`/it/objects/${encodeURIComponent('OBJ-ITINVENT:12')}`);
    expect(screen.getByText('Никулин Александр Сергеевич')).toBeTruthy();
    expect(screen.getByText('НА')).toBeTruthy();
    expect(screen.getByText('Айтишник не назначен')).toBeTruthy();
    expect(screen.queryByText(/Пароли:|Компьютеры:|Управление|Просмотр/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть' })).toBeNull();
  });

  it('deletes an object after a confirmation and brings it back from the deleted list', async () => {
    api.list.mockImplementation(async ({ hidden }) => (
      hidden
        ? { items: [{ ...beta, hidden: true }], can_manage: true }
        : { items: [alpha, beta], can_manage: true }
    ));
    api.hide.mockResolvedValue({ object_ref: beta.object_ref });
    api.restore.mockResolvedValue({ object_ref: beta.object_ref });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить объект Объект Бета' }));
    expect(api.hide).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.hide).toHaveBeenCalledWith(beta.object_ref));

    fireEvent.click(screen.getByLabelText('Удалённые'));
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть объект Объект Бета' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith(beta.object_ref));
  });

  it('adds an object with a name and an ITINVENT branch and opens its card', async () => {
    api.list.mockResolvedValue({ items: [alpha, { ...beta, custom: true, linked: false }], can_manage: true });
    api.create.mockResolvedValue({ object_ref: 'OBJ-HUB:abc', name: 'Новый склад' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить объект' }));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Новый склад' } });
    fireEvent.mouseDown(screen.getByLabelText('Филиал ITINVENT'));
    // Only ITINVENT branches can be linked, not objects created in HUB-IT.
    expect(screen.queryByRole('option', { name: 'Объект Бета' })).toBeNull();
    fireEvent.click(await screen.findByRole('option', { name: 'Объект Альфа' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ name: 'Новый склад', linkedRef: alpha.object_ref }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/it/objects/OBJ-HUB%3Aabc'));
  });
});
