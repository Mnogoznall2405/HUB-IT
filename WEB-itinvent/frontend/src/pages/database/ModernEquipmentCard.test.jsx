import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ModernEquipmentCard, { getEquipmentCardActionButtons } from './ModernEquipmentCard';
import { DATA_MODE_EQUIPMENT } from './equipmentModel';

const theme = createTheme();

const item = {
  INV_NO: '1001',
  SERIAL_NO: 'SN-1',
  TYPE_NAME: 'Printer',
  MODEL_NAME: 'LaserJet',
  OWNER_DISPLAY_NAME: 'Ivan Petrov',
  OWNER_DEPT: 'IT',
  DESCR: 'Active',
  LOCATION: 'Office',
};

const renderCard = (props = {}) => render(
  <ModernEquipmentCard
    item={item}
    theme={theme}
    onAction={() => {}}
    dataMode={DATA_MODE_EQUIPMENT}
    canWrite
    isAdmin
    {...props}
  />
);

describe('ModernEquipmentCard', () => {
  it('builds action button metadata and hides delete by default', () => {
    expect(getEquipmentCardActionButtons(['view', 'transfer', 'delete']).map((entry) => entry.action))
      .toEqual(['view', 'transfer']);
    expect(getEquipmentCardActionButtons(['delete'], { includeDelete: true }).map((entry) => entry.action))
      .toEqual(['delete']);
  });

  it('expands equipment details and wires action buttons', () => {
    const onAction = vi.fn();
    renderCard({ onAction });

    expect(screen.getByText('LaserJet')).toBeInTheDocument();
    expect(screen.getByText('INV: 1001')).toBeInTheDocument();

    fireEvent.click(screen.getByText('LaserJet'));

    expect(screen.getByText('Серийный номер')).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Переместить/ }));

    expect(onAction).toHaveBeenCalledWith('transfer', item);
  });

  it('toggles selection from the checkbox area and from card tap in selection mode', () => {
    const onToggleSelect = vi.fn();
    renderCard({ onToggleSelect, selectionMode: true });

    fireEvent.click(screen.getByTestId('database-mobile-select-1001'));
    fireEvent.click(screen.getByText('LaserJet'));

    expect(onToggleSelect).toHaveBeenNthCalledWith(1, '1001');
    expect(onToggleSelect).toHaveBeenNthCalledWith(2, '1001');
  });
});
