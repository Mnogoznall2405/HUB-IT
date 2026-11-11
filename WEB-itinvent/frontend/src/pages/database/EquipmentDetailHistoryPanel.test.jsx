import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EquipmentDetailHistoryPanel from './EquipmentDetailHistoryPanel';

const history = [
  {
    hist_id: 9,
    ch_date: '2026-05-02',
    old_employee_name: 'Ivan',
    new_employee_name: 'Petr',
    old_branch_name: 'Old branch',
    new_branch_name: 'New branch',
    old_location_name: 'Old room',
    new_location_name: 'New room',
    ch_user: 'operator',
    ch_comment: 'Moved after repair',
  },
];

const formatHistoryValue = (row, keys) => {
  const key = keys.find((candidate) => row[candidate] !== undefined && row[candidate] !== null);
  return key ? row[key] : '-';
};

const formatHistoryTransition = (row, oldKeys, newKeys) =>
  `${formatHistoryValue(row, oldKeys)} -> ${formatHistoryValue(row, newKeys)}`;

describe('EquipmentDetailHistoryPanel', () => {
  it('renders desktop history table', () => {
    render(
      <EquipmentDetailHistoryPanel
        history={history}
        formatDate={(value) => `date:${value}`}
        formatHistoryValue={formatHistoryValue}
        formatHistoryTransition={formatHistoryTransition}
      />
    );

    expect(screen.getByText('date:2026-05-02')).toBeInTheDocument();
    expect(screen.getByText('#9')).toBeInTheDocument();
    expect(screen.getByText('Ivan -> Petr')).toBeInTheDocument();
    expect(screen.getByText('Old branch -> New branch')).toBeInTheDocument();
    expect(screen.getByText('Old room -> New room')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('Moved after repair')).toBeInTheDocument();
  });

  it('renders mobile cards and empty/loading states', () => {
    const { rerender } = render(
      <EquipmentDetailHistoryPanel
        history={history}
        isMobile
        formatDate={(value) => value}
        formatHistoryValue={formatHistoryValue}
        formatHistoryTransition={formatHistoryTransition}
      />
    );

    expect(screen.getByText('Пользователь: operator')).toBeInTheDocument();
    expect(screen.getByText('Moved after repair')).toBeInTheDocument();

    rerender(<EquipmentDetailHistoryPanel history={[]} />);
    expect(screen.getByText('История перемещений для этого оборудования пока пустая.')).toBeInTheDocument();

    rerender(<EquipmentDetailHistoryPanel loading history={[]} />);
    expect(screen.getByText('Загрузка истории...')).toBeInTheDocument();
  });
});
