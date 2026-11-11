import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MaintenanceActionContent, {
  getMaintenanceConsumableEmptyText,
  getMaintenanceConsumableLabel,
} from './MaintenanceActionContent';

const ui = {
  panelBg: '#f8fafc',
  borderSoft: '#d8dee9',
  actionBg: '#fff',
};

const consumable = {
  id: 5,
  model_name: 'HP 12A',
  type_name: 'Toner',
  branch_name: 'HQ',
  location_name: 'Stock',
  qty: 2,
};

describe('MaintenanceActionContent helpers', () => {
  it('returns consumable labels and empty text per action type', () => {
    expect(getMaintenanceConsumableLabel({ actionType: 'cartridge' })).toBe('Картридж / расходник');
    expect(getMaintenanceConsumableLabel({ actionType: 'component', componentKind: 'printer' })).toBe('Запчасть / расходник');
    expect(getMaintenanceConsumableLabel({ actionType: 'component', componentKind: 'pc' })).toBe('Компонент / расходник');

    expect(getMaintenanceConsumableEmptyText({ actionType: 'cartridge', componentKind: 'printer' })).toBe('Нет запчастей (картриджи скрыты)');
    expect(getMaintenanceConsumableEmptyText({ actionType: 'cartridge', componentKind: null })).toBe('Расходники не найдены');
    expect(getMaintenanceConsumableEmptyText({ actionType: 'component' })).toBe('Картриджи не найдены');
  });
});

describe('MaintenanceActionContent', () => {
  it('renders cartridge consumable selector and history', () => {
    render(
      <MaintenanceActionContent
        actionType="cartridge"
        ui={ui}
        consumableOptions={[consumable]}
        selectedConsumable={consumable}
        cartridgeModel="HP 12A"
        cartridgeHistory={{ last_date: '2026-05-01', count: 2 }}
        formatDate={(value) => `date:${value}`}
      />
    );

    expect(screen.getByLabelText('Картридж / расходник')).toHaveValue('HP 12A | Toner | HQ / Stock | Остаток: 2');
    expect(screen.getByText('ИСТОРИЯ ЗАМЕНЫ КАРТРИДЖА: HP 12A')).toBeInTheDocument();
    expect(screen.getByText('Последняя: date:2026-05-01')).toBeInTheDocument();
  });

  it('renders battery and cleaning history states', () => {
    const { rerender } = render(
      <MaintenanceActionContent
        actionType="battery"
        ui={ui}
        batteryHistory={{ count: 0, last_date: null }}
      />
    );

    expect(screen.getByText('ИСТОРИЯ ЗАМЕНЫ БАТАРЕИ')).toBeInTheDocument();
    expect(screen.getByText('История замен батареи пуста')).toBeInTheDocument();

    rerender(
      <MaintenanceActionContent
        actionType="cleaning"
        ui={ui}
        cleaningHistory={{ last_date: '2026-04-30', count: 4 }}
        formatDate={(value) => value}
      />
    );

    expect(screen.getByText('ИСТОРИЯ ЧИСТОК')).toBeInTheDocument();
    expect(screen.getByText('Всего чисток: 4')).toBeInTheDocument();
  });

  it('renders component type selector and delegates type changes', () => {
    const onComponentTypeChange = vi.fn();

    render(
      <MaintenanceActionContent
        actionType="component"
        componentKind="pc"
        ui={ui}
        consumableOptions={[consumable]}
        selectedConsumable={null}
        componentType="ram"
        componentOptions={[
          { value: 'ram', label: 'ОЗУ' },
          { value: 'ssd', label: 'SSD' },
        ]}
        componentHistory={{ multiple: true }}
        onComponentTypeChange={onComponentTypeChange}
      />
    );

    fireEvent.mouseDown(screen.getByLabelText('Компонент ПК'));
    fireEvent.click(screen.getByRole('option', { name: 'SSD' }));

    expect(onComponentTypeChange).toHaveBeenCalledWith('ssd');
    expect(screen.getByLabelText('Компонент / расходник')).toBeInTheDocument();
    expect(screen.getByText('Для групповой операции история не отображается.')).toBeInTheDocument();
  });
});
