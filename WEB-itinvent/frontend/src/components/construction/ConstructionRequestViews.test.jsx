import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { ConstructionRequestDetail } from './ConstructionRequestViews';


function renderDetail(request) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ConstructionRequestDetail request={request} />
    </ThemeProvider>,
  );
}

describe('ConstructionRequestDetail supply fields', () => {
  it('shows Excel-like supply fields without project cipher', () => {
    renderDetail({
      request_number: 'СО583-3-152/3',
      positions_total: 1,
      stage: { key: 'ordered', label: 'Заказано поставщику' },
      warehouse_name: 'Склад объекта',
      responsible_name: 'Петров П.П.',
      delivery_responsible_names: ['Захарова Л.Ю.'],
      manager_names: ['Сидоров С.С.'],
      item_groups: [
        {
          name: 'Кабель силовой',
          section_code: 'ССФЗ-ТСО2',
          replacement_name: 'Кабель аналог',
          replacement_unit: 'м',
          quantity: 12,
          qty_requested: 12,
          qty_ordered: 10,
          qty_received: null,
          unit: 'м',
          receipt_number: '',
          receipt_warehouse_name: '',
          invoice_number: '',
          receipt_mol_name: '',
        },
      ],
      journey: [],
    });

    expect(screen.getByText('Ответственный за поставку')).toBeInTheDocument();
    expect(screen.getByText('Захарова Л.Ю.')).toBeInTheDocument();
    expect(screen.getByText('Раздел ССФЗ-ТСО2')).toBeInTheDocument();
    expect(screen.getByText(/Замена: Кабель аналог/)).toBeInTheDocument();
    expect(screen.getByText('В заявке')).toBeInTheDocument();
    expect(screen.getByText('В заказе поставщика')).toBeInTheDocument();
    expect(screen.getByText('В приходном ордере')).toBeInTheDocument();
    expect(screen.queryByText(/шифр проекта/i)).not.toBeInTheDocument();
    expect(screen.queryByText('583/3')).not.toBeInTheDocument();
  });
});
