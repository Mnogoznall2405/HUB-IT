import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DeleteEquipmentDialog from './DeleteEquipmentDialog';

const target = {
  invNo: '1001',
  item: {
    MODEL_NAME: 'LaserJet',
    OWNER_DISPLAY_NAME: 'Ivan Petrov',
  },
};

describe('DeleteEquipmentDialog', () => {
  it('renders target details and confirms deletion', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <DeleteEquipmentDialog
        target={target}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText(/1001/)).toBeInTheDocument();
    expect(screen.getByText(/LaserJet/)).toBeInTheDocument();
    expect(screen.getByText('Сотрудник: Ivan Petrov')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows errors and loading state', () => {
    render(
      <DeleteEquipmentDialog
        target={target}
        error="Не удалось удалить"
        loading
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByText('Не удалось удалить')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удаление...' })).toBeDisabled();
  });
});
