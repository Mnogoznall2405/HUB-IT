import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActResolvedItemsTable from './UploadActResolvedItemsTable';

describe('UploadActResolvedItemsTable', () => {
  it('renders resolved inventory rows', () => {
    render(
      <UploadActResolvedItemsTable
        items={[
          {
            item_id: 17,
            inv_no: '100887',
            serial_no: 'SN-17',
            model_name: 'Dell OptiPlex',
            employee_name: 'Иванов И.И.',
          },
        ]}
      />
    );

    expect(screen.getByText('Позиции, найденные по распознанным INV_NO')).toBeInTheDocument();
    expect(screen.getByText('100887')).toBeInTheDocument();
    expect(screen.getByText('SN-17')).toBeInTheDocument();
    expect(screen.getByText('Dell OptiPlex')).toBeInTheDocument();
    expect(screen.getByText('Иванов И.И.')).toBeInTheDocument();
  });

  it('renders an empty state when rows are missing', () => {
    render(<UploadActResolvedItemsTable items={[]} />);

    expect(screen.getByText(/Позиции не определены автоматически/)).toBeInTheDocument();
  });
});
