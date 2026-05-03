import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EquipmentDetailDialog from './EquipmentDetailDialog';

const data = {
  ID: 123,
  INV_NO: '1001',
  MODEL_NAME: 'HP LaserJet',
  DESCR: 'Работает',
  VENDOR_NAME: 'HP',
  SERIAL_NO: 'SN-1',
  HW_SERIAL_NO: 'HW-1',
  PART_NO: 'PN-1',
};

const form = {
  status_no: 1,
  type_no: 1,
  type_name: 'Printer',
  model_no: 10,
  model_name: 'HP LaserJet',
  serial_no: 'SN-1',
  hw_serial_no: 'HW-1',
  part_no: 'PN-1',
  ip_address: '10.0.0.1',
  mac_address: '00:11',
  network_name: 'PC-1',
  domain_name: 'domain.local',
  employee_name: 'Ivan Petrov',
  employee_dept: 'IT',
  branch_no: 7,
  branch_name: 'Главный',
  loc_no: 77,
  location_name: 'Склад',
  description: 'Рабочее место',
};

const options = {
  statuses: [
    { status_no: 1, status_name: 'Работает' },
    { status_no: 2, status_name: 'Списан' },
  ],
  types: [
    { type_no: 1, type_name: 'Printer' },
    { type_no: 2, type_name: 'Notebook' },
  ],
  models: [
    { model_no: 10, model_name: 'HP LaserJet' },
    { model_no: 20, model_name: 'Lenovo ThinkPad' },
  ],
  branches: [
    { branch_no: 7, branch_name: 'Главный' },
    { branch_no: 8, branch_name: 'Филиал' },
  ],
  locations: [
    { loc_no: 77, loc_name: 'Склад' },
    { loc_no: 88, loc_name: 'Кабинет' },
  ],
};

const renderDialog = (props = {}) => render(
  <EquipmentDetailDialog
    open
    data={data}
    form={form}
    tab="general"
    options={options}
    formatDate={(value) => `date:${value}`}
    formatHistoryValue={() => '-'}
    formatHistoryTransition={() => '-'}
    onClose={() => {}}
    {...props}
  />
);

describe('EquipmentDetailDialog', () => {
  it('renders read-only general tab without edit actions for read-only users', () => {
    renderDialog({ canWrite: false });

    expect(screen.getAllByText('HP LaserJet').length).toBeGreaterThan(0);
    expect(screen.getByText('Инв. № 1001 | ID 123')).toBeInTheDocument();
    expect(screen.getByText('Работает')).toBeInTheDocument();
    expect(screen.getAllByText('Главный').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Склад').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Создать QR-code' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument();
  });

  it('patches editable fields without owning parent state', () => {
    const onFormPatch = vi.fn();

    renderDialog({
      editMode: true,
      canWrite: true,
      onFormPatch,
    });

    fireEvent.mouseDown(screen.getByLabelText('Тип оборудования'));
    fireEvent.click(screen.getByRole('option', { name: 'Notebook' }));
    expect(onFormPatch).toHaveBeenCalledWith({
      type_no: 2,
      type_name: 'Notebook',
      model_no: null,
      model_name: '',
    });

    fireEvent.mouseDown(screen.getByLabelText('Модель'));
    fireEvent.click(screen.getByRole('option', { name: 'Lenovo ThinkPad' }));
    expect(onFormPatch).toHaveBeenCalledWith({
      model_no: 20,
      model_name: 'Lenovo ThinkPad',
    });

    fireEvent.mouseDown(screen.getByLabelText('Филиал'));
    fireEvent.click(screen.getByRole('option', { name: 'Филиал' }));
    expect(onFormPatch).toHaveBeenCalledWith({
      branch_no: '8',
      branch_name: 'Филиал',
    });

    fireEvent.change(screen.getByLabelText('Серийный номер'), {
      target: { value: 'SN-2' },
    });
    expect(onFormPatch).toHaveBeenCalledWith({ serial_no: 'SN-2' });
  });

  it('wires footer edit, cancel, save, and close actions', () => {
    const onStartEdit = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const { rerender } = renderDialog({
      canWrite: true,
      onStartEdit,
      onClose,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <EquipmentDetailDialog
        open
        data={data}
        form={form}
        tab="general"
        editMode
        canWrite
        hasChanges={false}
        saving={false}
        options={options}
        onCancel={onCancel}
        onSave={onSave}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <EquipmentDetailDialog
        open
        data={data}
        form={form}
        tab="general"
        editMode
        canWrite
        hasChanges
        saving={false}
        options={options}
        onCancel={onCancel}
        onSave={onSave}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders acts and history tabs through focused detail panels', () => {
    const onOpenActFields = vi.fn();
    const onOpenActFile = vi.fn();
    const { rerender } = renderDialog({
      tab: 'acts',
      acts: {
        items: [{
          doc_no: '77',
          doc_number: 'A-77',
          doc_date: '2026-05-02',
          branch_name: 'Главный',
          location_name: 'Склад',
          employee_name: 'Ivan Petrov',
        }],
        openingDocNo: '77',
      },
      onOpenActFields,
      onOpenActFile,
    });

    expect(screen.getAllByText('Текущий акт').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Поля' }));
    expect(onOpenActFields).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Открытие...' })).toBeDisabled();

    rerender(
      <EquipmentDetailDialog
        open
        data={data}
        form={form}
        tab="history"
        isMobile
        history={{
          items: [{
            hist_id: 9,
            ch_date: '2026-05-02',
            ch_user: 'operator',
          }],
        }}
        formatDate={(value) => value}
        formatHistoryValue={(row, keys) => row[keys[0]] || '-'}
        formatHistoryTransition={() => 'old -> new'}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Пользователь: operator')).toBeInTheDocument();
    expect(screen.getByText('old -> new / old -> new')).toBeInTheDocument();
  });
});
