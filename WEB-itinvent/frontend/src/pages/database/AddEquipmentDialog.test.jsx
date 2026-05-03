import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AddEquipmentDialog from './AddEquipmentDialog';

const ui = {
  actionHover: 'rgba(0,0,0,0.04)',
  panelBg: '#fff',
  panelInset: '#fafafa',
  borderSoft: '#ddd',
  borderStrong: '#bbb',
};

const baseForm = {
  employee_name: '',
  employee_no: null,
  employee_dept: '',
  branch_no: '',
  loc_no: '',
  type_no: '',
  status_no: '',
  serial_number: '',
  part_no: '',
  model_name: '',
  model_no: null,
  ip_address: '',
  description: '',
};

const renderDialog = (props = {}) => {
  const handlers = {
    onEmployeeInputChange: vi.fn(),
    onEmployeeSelect: vi.fn(),
    onFormPatch: vi.fn(),
    onErrorClear: vi.fn(),
    onModelsReset: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  render(
    <AddEquipmentDialog
      open
      ui={ui}
      form={baseForm}
      employeeOptions={[{ OWNER_NO: 7, OWNER_DISPLAY_NAME: 'Ivan Petrov', OWNER_DEPT: 'IT' }]}
      branchOptions={[{ branch_no: 10, branch_name: 'Главный' }]}
      typeOptions={[{ type_no: 2, type_name: 'Ноутбук' }]}
      statusOptions={[{ status_no: 1, status_name: 'В работе' }]}
      modelOptions={[{ model_no: 22, model_name: 'ThinkPad' }]}
      {...handlers}
      {...props}
    />
  );

  return handlers;
};

const selectById = async (id, optionName) => {
  fireEvent.mouseDown(document.getElementById(id));
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
};

const selectAutocompleteOption = async (label, query, optionText) => {
  const input = screen.getByRole('combobox', { name: label });
  fireEvent.change(input, { target: { value: query } });
  await waitFor(() => {
    expect(input.getAttribute('aria-controls')).toBeTruthy();
  });
  const listboxId = input.getAttribute('aria-controls');
  const listbox = await waitFor(() => {
    const nextListbox = document.getElementById(listboxId);
    expect(nextListbox).toBeTruthy();
    return nextListbox;
  });
  fireEvent.click(within(listbox).getByText(optionText));
};

describe('AddEquipmentDialog', () => {
  it('updates employee, branch, type, status and serial fields through parent callbacks', async () => {
    const handlers = renderDialog();

    await selectAutocompleteOption('Сотрудник *', 'Ivan', 'Ivan Petrov (IT)');

    expect(handlers.onFormPatch).toHaveBeenCalledWith({
      employee_name: 'Ivan Petrov',
      employee_no: 7,
      employee_dept: 'IT',
    });
    expect(handlers.onEmployeeSelect).toHaveBeenCalledWith('Ivan Petrov');

    await selectById('add-equipment-branch', 'Главный');
    await selectById('add-equipment-type', 'Ноутбук');
    await selectById('add-equipment-status', 'В работе');

    expect(handlers.onFormPatch).toHaveBeenCalledWith({ branch_no: '10' });
    expect(handlers.onFormPatch).toHaveBeenCalledWith({ type_no: '2', model_name: '', model_no: null });
    expect(handlers.onModelsReset).toHaveBeenCalledTimes(1);
    expect(handlers.onFormPatch).toHaveBeenCalledWith({ status_no: '1' });

    fireEvent.change(screen.getByRole('textbox', { name: /Серийный номер/ }), { target: { value: 'SN-1' } });

    expect(handlers.onFormPatch).toHaveBeenCalledWith({ serial_number: 'SN-1' });
    expect(handlers.onErrorClear).toHaveBeenCalled();
  });

  it('selects an existing model and wires close/save actions', async () => {
    const handlers = renderDialog();

    await selectAutocompleteOption('Модель *', 'Think', 'ThinkPad');

    await waitFor(() => {
      expect(handlers.onFormPatch).toHaveBeenCalledWith({ model_name: 'ThinkPad', model_no: 22 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows manual creation hints and error/success states', () => {
    renderDialog({
      form: { ...baseForm, employee_name: 'Manual Owner', model_name: 'Manual Model' },
      usesManualEmployee: true,
      usesManualModel: true,
      error: 'Заполните поля',
      success: 'Оборудование добавлено',
    });

    expect(screen.getByText('Сотрудник Manual Owner не найден в списке и будет создан автоматически.')).toBeInTheDocument();
    expect(screen.getByText('Модель Manual Model не найдена в списке и будет создана автоматически.')).toBeInTheDocument();
    expect(screen.getByText('Заполните поля')).toBeInTheDocument();
    expect(screen.getByText('Оборудование добавлено')).toBeInTheDocument();
  });

  it('disables actions while saving', () => {
    renderDialog({ loading: true });

    expect(screen.getByRole('button', { name: 'Сохранение...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  });
});
