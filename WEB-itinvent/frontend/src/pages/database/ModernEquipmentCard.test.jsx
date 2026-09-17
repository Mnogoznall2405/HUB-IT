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
    expect(getEquipmentCardActionButtons(['view', 'location_transfer', 'transfer', 'delete']).map((entry) => entry.action))
      .toEqual(['view', 'location_transfer', 'transfer']);
    expect(getEquipmentCardActionButtons(['delete'], { includeDelete: true }).map((entry) => entry.action))
      .toEqual(['delete']);
  });

  it('expands equipment details and wires action buttons', () => {
    const onAction = vi.fn();
    renderCard({ onAction });

    expect(screen.getByText('1001 · LaserJet')).toBeInTheDocument();

    fireEvent.click(screen.getByText('1001 · LaserJet'));

    expect(screen.getByText(/S\/N:/)).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Перемещение с актом/ }));

    expect(onAction).toHaveBeenCalledWith('transfer', item);
  });

  it('hides the selection checkbox until selection mode is enabled', () => {
    renderCard({ onToggleSelect: vi.fn(), selectionMode: false });

    expect(screen.queryByTestId('database-mobile-select-1001')).not.toBeInTheDocument();
  });

  it('toggles selection from the checkbox area and from card tap in selection mode', () => {
    const onToggleSelect = vi.fn();
    renderCard({ onToggleSelect, selectionMode: true });

    fireEvent.click(screen.getByTestId('database-mobile-select-1001'));
    fireEvent.click(screen.getByText('1001 · LaserJet'));

    expect(onToggleSelect).toHaveBeenNthCalledWith(1, '1001');
    expect(onToggleSelect).toHaveBeenNthCalledWith(2, '1001');
  });

  it('keeps expanded state in the feature store across unmount/remount', () => {
    function Harness() {
      const [expandedSet, setExpandedSet] = React.useState(() => new Set());
      const [mounted, setMounted] = React.useState(true);
      const toggleExpand = (invNo) => setExpandedSet((prev) => {
        const next = new Set(prev);
        if (next.has(invNo)) next.delete(invNo); else next.add(invNo);
        return next;
      });
      return (
        <>
          <button type="button" onClick={() => setMounted((v) => !v)}>mount-toggle</button>
          {mounted ? (
            <ModernEquipmentCard
              item={item}
              theme={theme}
              onAction={() => {}}
              dataMode={DATA_MODE_EQUIPMENT}
              canWrite
              isAdmin
              expanded={expandedSet.has('1001')}
              onToggleExpand={toggleExpand}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    expect(screen.getByText(/S\/N:/)).toBeInTheDocument();

    // Card unmounts (scroll/virtualization/section collapse) and remounts —
    // the controlled expanded state must survive.
    fireEvent.click(screen.getByRole('button', { name: 'mount-toggle' }));
    expect(screen.queryByText(/S\/N:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mount-toggle' }));
    expect(screen.getByText(/S\/N:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument();
  });

  it('opens the current act from the compact mobile status', () => {
    const onOpenCurrentAct = vi.fn();
    renderCard({
      item: {
        ...item,
        current_act_available: true,
        current_act_doc_no: 901,
        current_act_doc_number: 'ACT-901',
      },
      onOpenCurrentAct,
    });

    fireEvent.click(screen.getByRole('button', { name: /Открыть актуальный акт ACT-901/ }));

    expect(onOpenCurrentAct).toHaveBeenCalledWith(expect.objectContaining({
      doc_no: 901,
      inv_no: '1001',
    }));
  });
});
