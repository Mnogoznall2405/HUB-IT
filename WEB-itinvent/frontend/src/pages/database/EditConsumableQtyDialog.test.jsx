import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditConsumableQtyDialog from './EditConsumableQtyDialog';

const item = {
  MODEL_NAME: 'Toner Black',
  INV_NO: 'C-100',
  ID: 42,
};

describe('EditConsumableQtyDialog', () => {
  it('renders consumable identity and delegates value changes', () => {
    const onValueChange = vi.fn();

    render(
      <EditConsumableQtyDialog
        open
        item={item}
        value="3"
        onClose={() => {}}
        onValueChange={onValueChange}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByText('Toner Black')).toBeInTheDocument();
    expect(screen.getByText(/Инв. № C-100/)).toBeInTheDocument();
    expect(screen.getByText(/ID 42/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Количество/ }), { target: { value: '7' } });

    expect(onValueChange).toHaveBeenCalledWith('7');
  });

  it('shows error and wires close/save buttons', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(
      <EditConsumableQtyDialog
        open
        item={item}
        value="3"
        error="Введите количество"
        onClose={onClose}
        onValueChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Введите количество')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables actions while saving', () => {
    render(
      <EditConsumableQtyDialog
        open
        item={item}
        value="3"
        loading
        onClose={() => {}}
        onValueChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Сохранение...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  });
});
