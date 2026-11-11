import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AddConsumableDialog from './AddConsumableDialog';

const baseForm = {
  branch_no: '',
  loc_no: '',
  type_no: '',
  model_name: '',
  model_no: null,
  qty: '1',
};

const branchOptions = [
  { branch_no: 10, branch_name: 'Главный' },
];

const typeOptions = [
  { type_no: 4, type_name: 'Картридж' },
];

const modelOptions = [
  { model_no: 44, model_name: 'Toner Black' },
];

const renderDialog = (props = {}) => {
  const onFormPatch = vi.fn();
  const onErrorClear = vi.fn();
  const onModelsReset = vi.fn();
  const onClose = vi.fn();
  const onSubmit = vi.fn();

  render(
    <AddConsumableDialog
      open
      form={baseForm}
      branchOptions={branchOptions}
      typeOptions={typeOptions}
      modelOptions={modelOptions}
      onFormPatch={onFormPatch}
      onErrorClear={onErrorClear}
      onModelsReset={onModelsReset}
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />
  );

  return { onFormPatch, onErrorClear, onModelsReset, onClose, onSubmit };
};

const selectOption = async (label, optionText) => {
  const selectId = label.startsWith('Филиал') ? 'add-consumable-branch' : 'add-consumable-type';
  fireEvent.mouseDown(document.getElementById(selectId));
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: optionText }));
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

describe('AddConsumableDialog', () => {
  it('updates branch, type and quantity through parent callbacks', async () => {
    const handlers = renderDialog();

    await selectOption('Филиал *', 'Главный');

    expect(handlers.onFormPatch).toHaveBeenCalledWith({ branch_no: '10' });

    await selectOption('Тип расходника *', 'Картридж');

    expect(handlers.onFormPatch).toHaveBeenCalledWith({ type_no: '4', model_name: '', model_no: null });
    expect(handlers.onModelsReset).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('spinbutton', { name: /Количество/ }), { target: { value: '5' } });

    expect(handlers.onFormPatch).toHaveBeenCalledWith({ qty: '5' });
    expect(handlers.onErrorClear).toHaveBeenCalled();
  });

  it('shows auto-create model hint, error and success messages', () => {
    renderDialog({
      form: { ...baseForm, type_no: '4', model_name: 'New toner', model_no: null },
      error: 'Заполните поля',
      success: 'Расходник добавлен',
    });

    expect(screen.getByText('Модель New toner не найдена в списке и будет создана автоматически.')).toBeInTheDocument();
    expect(screen.getByText('Заполните поля')).toBeInTheDocument();
    expect(screen.getByText('Расходник добавлен')).toBeInTheDocument();
  });

  it('selects an existing model and wires close/save buttons', async () => {
    const handlers = renderDialog();

    await selectAutocompleteOption('Модель *', 'Toner', 'Toner Black');

    await waitFor(() => {
      expect(handlers.onFormPatch).toHaveBeenCalledWith({ model_name: 'Toner Black', model_no: 44 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('disables actions while saving', () => {
    renderDialog({ loading: true });

    expect(screen.getByRole('button', { name: 'Сохранение...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  });
});
