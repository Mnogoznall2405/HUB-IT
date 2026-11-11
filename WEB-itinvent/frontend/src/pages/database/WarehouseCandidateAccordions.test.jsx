import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WarehouseCandidateAccordions from './WarehouseCandidateAccordions';

const candidates = [
  { ref: 'wh-1', name: 'Рябов А.С. (офис)' },
  { ref: 'wh-2', name: 'Рябов А.С. (склад)' },
];

function Harness({ loadBalances }) {
  const [byRef, setByRef] = useState({});
  return (
    <WarehouseCandidateAccordions
      candidates={candidates}
      balancesByRef={byRef}
      onLoadBalances={(ref) => {
        loadBalances(ref);
        setByRef((prev) => ({
          ...prev,
          [ref]: {
            loading: false,
            error: '',
            meta: null,
            rows: ref === 'wh-1'
              ? [{ nomenclature_ref: 'n1', nomenclature_code: 'К-1', nomenclature_name: 'Мышь USB', qty_balance: 2 }]
              : [],
          },
        }));
      }}
    />
  );
}

describe('WarehouseCandidateAccordions', () => {
  it('expands a warehouse in place, loads its balances once and collapses back', async () => {
    const loadBalances = vi.fn();
    render(<Harness loadBalances={loadBalances} />);

    expect(screen.queryByText('Мышь USB')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Рябов А\.С\. \(офис\)/ }));
    expect(await screen.findByText('Мышь USB')).toBeTruthy();
    expect(loadBalances).toHaveBeenCalledTimes(1);
    expect(loadBalances).toHaveBeenCalledWith('wh-1');

    // The second warehouse stays closed until it is opened itself.
    expect(screen.queryByText(/нет позиций/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Рябов А\.С\. \(офис\)/ }));
    await waitFor(() => expect(screen.queryByText('Мышь USB')).toBeNull());
  });

  it('shows an empty warehouse as such', async () => {
    render(<Harness loadBalances={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Рябов А\.С\. \(склад\)/ }));
    expect(await screen.findByText(/нет позиций/)).toBeTruthy();
  });
});
