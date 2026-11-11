import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const {
  mockCreateManagedObject,
  mockGetManagement,
  mockSearchEmployees,
  mockUpdateManagedObject,
} = vi.hoisted(() => ({
  mockCreateManagedObject: vi.fn(),
  mockGetManagement: vi.fn(),
  mockSearchEmployees: vi.fn(),
  mockUpdateManagedObject: vi.fn(),
}));

vi.mock('../../api/construction', () => ({
  constructionAPI: {
    createManagedObject: mockCreateManagedObject,
    getManagement: mockGetManagement,
    searchEmployees: mockSearchEmployees,
    updateManagedObject: mockUpdateManagedObject,
  },
}));

import ConstructionObjectSettingsDialog from './ConstructionObjectSettingsDialog';


const group = {
  group_ref: '11111111-1111-1111-1111-111111111111',
  group_name: 'ЕАСИ',
};

function renderDialog(props = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ConstructionObjectSettingsDialog
        open
        item={{
          object_ref: group.group_ref,
          name: group.group_name,
          kind: 'project',
          source_groups: [group],
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

function renderRoutedDialog({ onClose = vi.fn(), onSaved } = {}) {
  let navigate;
  function SettingsRoute() {
    navigate = useNavigate();
    return <ConstructionObjectSettingsDialog open item={{ object_ref: group.group_ref, name: 'ЕАСИ', kind: 'project', source_groups: [group] }} onClose={onClose} onSaved={onSaved || (() => navigate('/saved'))} />;
  }
  render(<MemoryRouter initialEntries={['/settings']}><ThemeProvider theme={createTheme()}><Routes>
    <Route path="/settings" element={<SettingsRoute />} />
    <Route path="/other" element={<h1>Другая страница</h1>} />
    <Route path="/saved" element={<h1>Созданный объект</h1>} />
  </Routes></ThemeProvider></MemoryRouter>);
  return { navigate: (path) => act(() => navigate(path)), onClose };
}

describe('ConstructionObjectSettingsDialog', () => {
  beforeEach(() => {
    mockCreateManagedObject.mockReset();
    mockGetManagement.mockReset();
    mockSearchEmployees.mockReset();
    mockUpdateManagedObject.mockReset();
    mockGetManagement.mockResolvedValue({ objects: [], available_groups: [group] });
    mockSearchEmployees.mockResolvedValue({ items: [], total: 0, limit: 30 });
    mockCreateManagedObject.mockResolvedValue({ id: 'construction-1', name: 'ЕАСИ', groups: [group] });
  });

  it('creates one managed object from the selected 1C group', async () => {
    const onSaved = vi.fn();
    renderDialog({ onSaved });

    expect(await screen.findAllByDisplayValue('ЕАСИ')).not.toHaveLength(0);
    expect(screen.getByRole('radio', { name: 'Отдельный проект' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /Номенклатурные группы/ })).toHaveValue('ЕАСИ');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить объект' }));

    await waitFor(() => {
      expect(mockCreateManagedObject).toHaveBeenCalledWith({
        name: 'ЕАСИ',
        groups: [group],
        roles: [
          { role_key: 'project_lead', employee_code: null },
          { role_key: 'pto_manager', employee_code: null },
          { role_key: 'umto_coordinator', employee_code: null },
          { role_key: 'chief_project_engineer', employee_code: null },
        ],
      });
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'construction-1' }));
  });

  it('combines projects only after selecting combined mode', async () => {
    const second = { group_ref: '22222222-2222-2222-2222-222222222222', group_name: 'Второй проект' };
    mockGetManagement.mockResolvedValue({ objects: [], available_groups: [group, second] });
    renderDialog();
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.click(screen.getByRole('radio', { name: 'Объединённый объект' }));
    const input = screen.getByRole('combobox', { name: /Номенклатурные группы/ });
    fireEvent.change(input, { target: { value: 'Второй' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Второй проект' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить объект' }));
    await waitFor(() => expect(mockCreateManagedObject).toHaveBeenCalledWith(expect.objectContaining({ groups: [group, second] })));
  });

  it('shows role history for an existing managed object', async () => {
    mockGetManagement.mockResolvedValue({
      available_groups: [group],
      objects: [{
        id: 'construction-1',
        name: 'ЕАСИ',
        groups: [group],
        team: [],
        role_history: [{
          role_key: 'project_lead',
          employee_code: 'E-1',
          full_name: 'Иванов Иван Иванович',
          valid_from: '2026-08-01T00:00:00Z',
          valid_to: '2026-08-31T00:00:00Z',
        }],
      }],
    });
    renderDialog({
      item: {
        managed_object_id: 'construction-1',
        object_ref: 'managed:construction-1',
        name: 'ЕАСИ',
        kind: 'project',
      },
    });

    expect(await screen.findByText('История назначений (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('История назначений (1)'));
    expect(screen.getByText(/Иванов Иван Иванович/)).toBeInTheDocument();
  });

  it('preserves edits when the parent refreshes the same object', async () => {
    const props = { open: true, item: { object_ref: group.group_ref, name: 'ЕАСИ', kind: 'project', source_groups: [group] }, onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = renderDialog(props);
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Название в работе' } });
    rerender(<ThemeProvider theme={createTheme()}><ConstructionObjectSettingsDialog {...props} item={{ ...props.item, name: 'Обновлённое имя с сервера' }} /></ThemeProvider>);
    expect(screen.getByLabelText('Название объекта')).toHaveValue('Название в работе');
    expect(mockGetManagement).toHaveBeenCalledTimes(1);
  });

  it('clears previous values and blocks saving when reopening fails, then allows retry', async () => {
    const props = { item: { object_ref: group.group_ref, name: 'ЕАСИ', kind: 'project', source_groups: [group] }, onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = renderDialog(props);
    await screen.findAllByDisplayValue('ЕАСИ');
    rerender(<ThemeProvider theme={createTheme()}><ConstructionObjectSettingsDialog {...props} open={false} /></ThemeProvider>);
    mockGetManagement.mockRejectedValueOnce(new Error('Сервис недоступен'));
    rerender(<ThemeProvider theme={createTheme()}><ConstructionObjectSettingsDialog {...props} open /></ThemeProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис недоступен');
    expect(screen.getByLabelText('Название объекта')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Сохранить объект' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findAllByDisplayValue('ЕАСИ');
    expect(screen.getByRole('button', { name: 'Сохранить объект' })).toBeEnabled();
  });

  it('asks before discarding edits and can continue editing', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Новый объект' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Отменить изменения настроек?' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Продолжить редактирование' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отменить изменения настроек?' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Название объекта')).toHaveValue('Новый объект');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Отменить изменения настроек?' })).getByRole('button', { name: 'Отменить изменения' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the loaded revision and preserves the draft on a concurrent edit conflict', async () => {
    const updatedAt = '2026-09-08T10:00:00Z';
    mockGetManagement.mockResolvedValue({ available_groups: [group], objects: [{ id: 'construction-1', name: 'ЕАСИ', groups: [group], team: [], updated_at: updatedAt }] });
    mockUpdateManagedObject.mockRejectedValue({ response: { status: 409, data: { detail: 'Настройки уже изменены другим сотрудником' } } });
    renderDialog({ item: { managed_object_id: 'construction-1', name: 'ЕАСИ', kind: 'project' } });
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Мой вариант' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить объект' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('другим сотрудником');
    expect(mockUpdateManagedObject).toHaveBeenCalledWith('construction-1', expect.objectContaining({ name: 'Мой вариант', expected_updated_at: updatedAt }));
    expect(screen.getByLabelText('Название объекта')).toHaveValue('Мой вариант');
    fireEvent.click(screen.getByRole('button', { name: 'Обновить настройки' }));
    expect(screen.getByRole('dialog', { name: 'Отменить изменения настроек?' })).toBeInTheDocument();
    expect(mockGetManagement).toHaveBeenCalledTimes(1);
  });

  it('protects a dirty settings form on route changes and allows staying or leaving', async () => {
    const { navigate, onClose } = renderRoutedDialog();
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Незавершённое название' } });
    navigate('/other');
    const dialog = await screen.findByRole('dialog', { name: 'В настройках остались несохранённые изменения' });
    expect(screen.queryByRole('heading', { name: 'Другая страница' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Остаться в настройках' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'В настройках остались несохранённые изменения' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Название объекта')).toHaveValue('Незавершённое название');
    navigate('/other');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'В настройках остались несохранённые изменения' })).getByRole('button', { name: 'Уйти без сохранения' }));
    expect(await screen.findByRole('heading', { name: 'Другая страница' })).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateManagedObject).not.toHaveBeenCalled();
  });

  it('waits for saving and allows the successful creation callback to navigate', async () => {
    let finishSave;
    mockCreateManagedObject.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { navigate } = renderRoutedDialog();
    await screen.findAllByDisplayValue('ЕАСИ');
    fireEvent.change(screen.getByLabelText('Название объекта'), { target: { value: 'Сохранённый объект' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить объект' }));
    await waitFor(() => expect(mockCreateManagedObject).toHaveBeenCalledTimes(1));
    navigate('/other');
    const dialog = await screen.findByRole('dialog', { name: 'В настройках остались несохранённые изменения' });
    expect(within(dialog).getByText('Дождитесь завершения сохранения.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Уйти без сохранения' })).toBeDisabled();
    await act(async () => { finishSave({ id: 'construction-created' }); });
    expect(await screen.findByRole('heading', { name: 'Созданный объект' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
