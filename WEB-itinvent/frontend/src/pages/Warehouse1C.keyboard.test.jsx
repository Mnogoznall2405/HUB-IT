import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BalanceNomenclatureCell, MovementTableRow } from './Warehouse1C';

const openableRow = {
  registrar_ref: 'doc-1',
  registrar_name: 'Поступление 12/34',
  period: '2026-11-20',
};

const closedRow = { registrar_name: 'Корректировка', period: '2026-11-20' };

const renderRow = (row, onOpenDetail) => render(
  <table>
    <tbody>
      <MovementTableRow row={row} onOpenDetail={onOpenDetail} />
    </tbody>
  </table>,
);

describe('MovementTableRow keyboard access', () => {
  it('opens the document card via Enter and Space', () => {
    const onOpenDetail = vi.fn();
    renderRow(openableRow, onOpenDetail);

    const row = screen.getByRole('button');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
    expect(onOpenDetail).toHaveBeenCalledWith(openableRow);
  });

  it('stays non-interactive when the row cannot open a detail card', () => {
    const onOpenDetail = vi.fn();
    const { container } = renderRow(closedRow, onOpenDetail);

    const row = container.querySelector('tr');
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});

describe('BalanceNomenclatureCell keyboard access', () => {
  it('exposes the hub-match action to the keyboard', () => {
    const onOpenHubMatch = vi.fn();
    const row = {
      nomenclature_code: 'PN-1',
      nomenclature_name: 'Кабель',
    };
    render(
      <table>
        <tbody>
          <tr>
            <BalanceNomenclatureCell row={row} onOpenHubMatch={onOpenHubMatch} />
          </tr>
        </tbody>
      </table>,
    );

    const cell = screen.getByRole('button');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onOpenHubMatch).toHaveBeenCalledWith(row);
  });
});
