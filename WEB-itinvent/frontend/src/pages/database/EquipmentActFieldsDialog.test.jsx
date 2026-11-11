import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EquipmentActFieldsDialog from './EquipmentActFieldsDialog';

const selectedAct = {
  doc_no: '77',
  doc_number: 'A-77',
};

const summary = {
  docNumber: 'A-77',
  docNo: '77',
  docDate: '2026-05-02',
  typeName: 'Перемещение',
  branchName: 'Главный',
  locationName: 'Склад',
  employeeName: 'Ivan Petrov',
  itemId: '123',
  createDate: '2026-05-01',
  createUser: 'admin',
  changeDate: '2026-05-02',
  changeUser: 'operator',
  addInfo: 'Описание акта',
};

describe('EquipmentActFieldsDialog', () => {
  it('renders act fields and opens the act file', () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();

    render(
      <EquipmentActFieldsDialog
        open
        onClose={onClose}
        selectedAct={selectedAct}
        summary={summary}
        onOpenFile={onOpenFile}
        formatDate={(value) => `date:${value}`}
      />
    );

    expect(screen.getByText('Поля документа № A-77')).toBeInTheDocument();
    expect(screen.getByText('date:2026-05-02')).toBeInTheDocument();
    expect(screen.getByText('Ivan Petrov')).toBeInTheDocument();
    expect(screen.getByText('Описание акта')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть файл' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onOpenFile).toHaveBeenCalledWith(selectedAct);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders act description line', () => {
    render(
      <EquipmentActFieldsDialog
        open
        onClose={() => {}}
        selectedAct={selectedAct}
        summary={{
          ...summary,
          addInfo: 'Акт 1464 Санду А.О. - Козловский А.М. от 29.06.2026',
        }}
        onOpenFile={() => {}}
      />
    );

    expect(screen.getByText('Акт 1464 Санду А.О. - Козловский А.М. от 29.06.2026')).toBeInTheDocument();
  });

  it('shows empty state when no document is selected', () => {
    render(
      <EquipmentActFieldsDialog
        open
        onClose={() => {}}
        selectedAct={null}
        summary={null}
        onOpenFile={() => {}}
      />
    );

    expect(screen.getByText('Документ не выбран.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть файл' })).not.toBeInTheDocument();
  });

  it('disables file opening while the same document is opening', () => {
    render(
      <EquipmentActFieldsDialog
        open
        onClose={() => {}}
        selectedAct={selectedAct}
        summary={summary}
        openingDocNo="77"
        onOpenFile={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Открытие...' })).toBeDisabled();
  });
});
