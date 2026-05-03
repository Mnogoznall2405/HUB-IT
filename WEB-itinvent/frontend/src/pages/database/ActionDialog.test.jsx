import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ActionDialog, {
  getActionConfirmLabel,
  getActionDialogTitle,
  getActionSelectedSummary,
  shouldShowActionConfirm,
} from './ActionDialog';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';

const ui = {
  panelBg: '#f8fafc',
  borderSoft: '#d8dee9',
  actionBg: '#fff',
};

describe('ActionDialog helpers', () => {
  it('returns titles, summaries, labels, and confirm visibility', () => {
    expect(getActionDialogTitle({
      type: 'transfer',
      transferOperationMode: TRANSFER_OPERATION_ACT_ONLY,
    })).toBe('Акт без перемещения');
    expect(getActionDialogTitle({
      type: 'transfer',
      transferOperationMode: TRANSFER_OPERATION_MOVE,
    })).toBe('Перемещение оборудования');
    expect(getActionDialogTitle({ type: 'component', componentKind: 'pc' })).toBe('Замена компонента ПК');
    expect(getActionDialogTitle({ type: 'component', componentKind: 'printer' })).toBe('Замена компонента');

    expect(getActionSelectedSummary(2)).toBe('Выбрано 2 ед. оборудования');
    expect(getActionSelectedSummary(1)).toBe('Выбрано 1 ед. оборудования');
    expect(getActionSelectedSummary(0)).toBe('Подтвердите действие.');

    expect(getActionConfirmLabel({ loading: true })).toBe('Выполнение...');
    expect(getActionConfirmLabel({
      type: 'transfer',
      transferOperationMode: TRANSFER_OPERATION_ACT_ONLY,
    })).toBe('Создать акт');
    expect(getActionConfirmLabel({
      type: 'transfer',
      transferOperationMode: TRANSFER_OPERATION_MOVE,
    })).toBe('Выполнить перемещение');
    expect(getActionConfirmLabel({ type: 'cleaning' })).toBe('Подтвердить');

    expect(shouldShowActionConfirm({ canDatabaseWrite: true, type: 'cleaning' })).toBe(true);
    expect(shouldShowActionConfirm({ canDatabaseWrite: false, type: 'cleaning' })).toBe(false);
    expect(shouldShowActionConfirm({
      canDatabaseWrite: true,
      type: 'transfer',
      transferResult: { doc_no: 12 },
    })).toBe(false);
  });
});

describe('ActionDialog', () => {
  it('renders maintenance content and delegates close and confirm actions', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ActionDialog
        open
        actionModal={{ open: true, type: 'cleaning', componentKind: null }}
        selectedCount={2}
        canDatabaseWrite
        actionError="Ошибка действия"
        onClose={onClose}
        onConfirm={onConfirm}
        maintenanceContentProps={{
          ui,
          cleaningHistory: { last_date: '2026-05-01', count: 3 },
          formatDate: (value) => `date:${value}`,
        }}
      />
    );

    expect(screen.getByText('Чистка ПК')).toBeInTheDocument();
    expect(screen.getByText('Выбрано 2 ед. оборудования')).toBeInTheDocument();
    expect(screen.getByText('ИСТОРИЯ ЧИСТОК')).toBeInTheDocument();
    expect(screen.getByText('Всего чисток: 3')).toBeInTheDocument();
    expect(screen.getByText('Ошибка действия')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides confirm button when transfer already has a result', () => {
    render(
      <ActionDialog
        open
        actionModal={{ open: true, type: 'transfer' }}
        selectedCount={1}
        canDatabaseWrite
        transferOperationMode={TRANSFER_OPERATION_ACT_ONLY}
        transferResult={{ doc_no: 12 }}
        transferContentProps={{
          canDatabaseWrite: true,
          transfer: {
            mode: TRANSFER_OPERATION_ACT_ONLY,
            result: { doc_no: 12 },
          },
          email: {},
          actions: {},
        }}
      />
    );

    expect(screen.getByText('Акт без перемещения')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать акт' })).not.toBeInTheDocument();
  });
});
