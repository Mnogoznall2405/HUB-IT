import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EquipmentDetailActsPanel from './EquipmentDetailActsPanel';

const acts = [
  {
    doc_no: '77',
    doc_number: 'A-77',
    doc_date: '2026-05-02',
    create_date: '2026-05-01',
    type_name: 'Перемещение',
    branch_name: 'Главный',
    location_name: 'Склад',
    employee_name: 'Ivan Petrov',
  },
];

describe('EquipmentDetailActsPanel', () => {
  it('renders current act, table rows, and delegates actions', () => {
    const onOpenFields = vi.fn();
    const onOpenFile = vi.fn();

    render(
      <EquipmentDetailActsPanel
        acts={acts}
        onOpenFields={onOpenFields}
        onOpenFile={onOpenFile}
        formatDate={(value) => `date:${value}`}
      />
    );

    expect(screen.getByText('Текущий акт')).toBeInTheDocument();
    expect(screen.getByText('№ A-77 | Дата: date:2026-05-02')).toBeInTheDocument();
    expect(screen.getByText('Создан: date:2026-05-01')).toBeInTheDocument();
    expect(screen.getByText('Перемещение')).toBeInTheDocument();
    expect(screen.getByText('Главный / Склад')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Поля' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(onOpenFields).toHaveBeenCalledWith(acts[0]);
    expect(onOpenFile).toHaveBeenCalledWith(acts[0]);
  });

  it('renders error, loading, empty, and opening states', () => {
    const onErrorClose = vi.fn();
    const { rerender } = render(
      <EquipmentDetailActsPanel
        error="Ошибка актов"
        acts={[]}
        onErrorClose={onErrorClose}
      />
    );

    expect(screen.getByText('Ошибка актов')).toBeInTheDocument();
    expect(screen.getByText('Для этого оборудования не найдено привязанных актов.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onErrorClose).toHaveBeenCalledTimes(1);

    rerender(<EquipmentDetailActsPanel loading acts={[]} />);
    expect(screen.getByText('Загрузка актов...')).toBeInTheDocument();

    rerender(<EquipmentDetailActsPanel acts={acts} openingDocNo="77" />);
    expect(screen.getByRole('button', { name: 'Открытие...' })).toBeDisabled();
  });
});
