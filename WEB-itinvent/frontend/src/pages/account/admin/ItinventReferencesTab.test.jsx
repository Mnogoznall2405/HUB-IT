import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ItinventReferencesTab from './ItinventReferencesTab';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  usage: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const notifySuccess = vi.hoisted(() => vi.fn());

vi.mock('../../../api/itinventReferences', async () => {
  const actual = await vi.importActual('../../../api/itinventReferences');
  return { ...actual, itinventReferencesAPI: apiMock };
});
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotification: () => ({ notifySuccess }),
}));

const vendors = [{ id: 7, name: 'HP' }, { id: 8, name: 'Canon' }];

describe('ItinventReferencesTab', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    notifySuccess.mockReset();
    apiMock.list.mockImplementation(async (kind) => ({ items: kind === 'vendors' ? vendors : [] }));
  });

  it('adds a vendor in the selected database and reloads the list', async () => {
    apiMock.create.mockResolvedValue({ id: 9, name: 'Brother' });
    render(<ItinventReferencesTab dbOptions={[{ id: 'MSK-ITINVENT', name: 'Москва' }]} />);

    expect(await screen.findByText('HP')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Название/), { target: { value: '  Brother ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledWith(
      'vendors',
      { name: '  Brother ' },
      { dbId: 'MSK-ITINVENT' },
    ));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
  });

  it('filters the loaded list by search without asking the server again', async () => {
    render(<ItinventReferencesTab dbOptions={[{ id: 'ITINVENT', name: 'Основная' }]} />);

    expect(await screen.findByText('HP')).toBeInTheDocument();
    const vendorCalls = apiMock.list.mock.calls.filter(([kind]) => kind === 'vendors').length;
    fireEvent.change(screen.getByPlaceholderText('Поиск по названию'), { target: { value: 'can' } });

    await waitFor(() => expect(screen.queryByText('HP')).not.toBeInTheDocument());
    expect(screen.getByText('Canon')).toBeInTheDocument();
    expect(apiMock.list.mock.calls.filter(([kind]) => kind === 'vendors').length).toBe(vendorCalls);
  });

  it('adds a model choosing the type by typing in the searchable field', async () => {
    apiMock.list.mockImplementation(async (kind) => ({
      items: kind === 'types' ? [{ id: 3, name: 'Принтер' }, { id: 4, name: 'Монитор' }] : [],
    }));
    apiMock.create.mockResolvedValue({ id: 1, name: 'LaserJet' });
    render(<ItinventReferencesTab dbOptions={[{ id: 'ITINVENT', name: 'Основная' }]} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Модели' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Название/), { target: { value: 'LaserJet' } });
    const typeField = within(dialog).getByRole('combobox', { name: /Тип/ });
    fireEvent.change(typeField, { target: { value: 'при' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Принтер' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalledWith(
      'models',
      { name: 'LaserJet', type_no: 3, vendor_no: null, ci_type: 1 },
      { dbId: 'ITINVENT' },
    ));
  });

  it('shows where a vendor is used and does not allow deleting it', async () => {
    apiMock.usage.mockResolvedValue({
      id: 7,
      total: 3,
      usage: [{ table: 'CI_MODELS', label: 'модели', count: 3 }],
    });
    render(<ItinventReferencesTab dbOptions={[{ id: 'ITINVENT', name: 'Основная' }]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить HP' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/модели: 3/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(apiMock.remove).not.toHaveBeenCalled();
  });

  it('deletes an unused vendor after confirmation', async () => {
    apiMock.usage.mockResolvedValue({ id: 8, total: 0, usage: [] });
    apiMock.remove.mockResolvedValue({ success: true });
    render(<ItinventReferencesTab dbOptions={[{ id: 'ITINVENT', name: 'Основная' }]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить Canon' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Удалить' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith('vendors', 8, { dbId: 'ITINVENT', ciType: undefined }));
  });
});
