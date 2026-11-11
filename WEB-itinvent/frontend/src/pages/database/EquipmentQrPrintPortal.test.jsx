import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EquipmentQrPrintPortal, { EQUIPMENT_QR_PRINT_ROOT_ID } from './EquipmentQrPrintPortal';

describe('EquipmentQrPrintPortal', () => {
  it('groups up to twenty 50x50 labels on each hidden A4 print sheet', () => {
    const labels = Array.from({ length: 21 }, (_, index) => ({
      invNo: String(1001 + index),
      dataUrl: `data:image/png;base64,label-${index}`,
    }));
    render(<EquipmentQrPrintPortal labels={labels} />);

    const root = document.getElementById(EQUIPMENT_QR_PRINT_ROOT_ID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('.equipment-qr-print-sheet')).toHaveLength(2);
    expect(root.querySelector('[data-sheet-index="0"]')?.children).toHaveLength(20);
    expect(root.querySelector('[data-sheet-index="1"]')?.children).toHaveLength(1);
    expect(root.querySelectorAll('.equipment-qr-print-label')).toHaveLength(21);
    expect(root.querySelector('[data-inv-no="1001"] img')).toHaveAttribute(
      'src',
      'data:image/png;base64,label-0'
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
