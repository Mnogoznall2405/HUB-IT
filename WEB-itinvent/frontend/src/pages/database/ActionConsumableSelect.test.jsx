import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ActionConsumableSelect, { formatActionConsumableSourceSummary } from './ActionConsumableSelect';

const toner = {
  id: 5,
  model_name: 'HP 12A',
  type_name: 'Toner',
  branch_name: 'HQ',
  location_name: 'Stock',
  qty: 2,
};

const drum = {
  id: 6,
  model_name: 'Drum Unit',
  type_name: 'Part',
  branch_name: 'Branch',
  location_name: 'Shelf',
  qty: 1,
};

describe('ActionConsumableSelect helpers', () => {
  it('formats selected source summary', () => {
    expect(formatActionConsumableSourceSummary(null)).toBe('Источник не выбран');
    expect(formatActionConsumableSourceSummary(toner)).toBe('Источник: HQ / Stock | Остаток: 2');
    expect(formatActionConsumableSourceSummary({ qty: 0 })).toBe('Источник: - / - | Остаток: 0');
  });
});

describe('ActionConsumableSelect', () => {
  it('renders selected consumable and source summary', () => {
    render(
      <ActionConsumableSelect
        options={[toner]}
        value={toner}
        label="Картридж / расходник"
      />
    );

    expect(screen.getByLabelText('Картридж / расходник')).toHaveValue('HP 12A | Toner | HQ / Stock | Остаток: 2');
    expect(screen.getByText('Источник: HQ / Stock | Остаток: 2')).toBeInTheDocument();
  });

  it('delegates option selection to parent state', () => {
    const onChange = vi.fn();

    render(
      <ActionConsumableSelect
        options={[toner, drum]}
        value={null}
        onChange={onChange}
        label="Компонент / расходник"
      />
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Компонент / расходник' }));
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByText('Drum Unit'));

    expect(onChange).toHaveBeenCalledWith(drum);
  });

  it('shows custom empty text', () => {
    render(
      <ActionConsumableSelect
        options={[]}
        value={null}
        label="Запчасть / расходник"
        noOptionsText="Картриджи не найдены"
      />
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Запчасть / расходник' }));

    expect(screen.getByText('Картриджи не найдены')).toBeInTheDocument();
  });
});
