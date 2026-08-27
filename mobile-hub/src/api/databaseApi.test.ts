import apiClient from './client';
import {
  createConsumable,
  createEquipment,
  commitUploadedEquipmentAct,
  deleteConsumable,
  deleteEquipment,
  getCurrentDatabase,
  getEquipment,
  getEquipmentActs,
  getEquipmentHistory,
  getEquipmentWorkHistories,
  getUploadedEquipmentActDraft,
  listAvailableDatabases,
  listConsumables,
  listEquipment,
  listEquipmentBranches,
  listEquipmentLocations,
  listRecentEquipmentCards,
  parseUploadedEquipmentAct,
  recordEquipmentWork,
  searchEquipment,
  searchEquipmentActs,
  switchDatabase,
  submitEquipmentTransfer,
  updateConsumableQuantity,
  updateEquipment,
  UPLOADED_ACT_PARSE_TIMEOUT_MS,
} from './databaseApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock; delete: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

it('loads available and current server-owned database selection', async () => {
  client.get
    .mockResolvedValueOnce({ data: [{ id: 'OBJ-ITINVENT', name: 'Объекты', access: 'read-write' }] })
    .mockResolvedValueOnce({ data: { id: 'OBJ-ITINVENT', name: 'OBJ', source: 'assigned', locked: 'true' } });
  await expect(listAvailableDatabases()).resolves.toEqual([{ id: 'OBJ-ITINVENT', name: 'Объекты' }]);
  await expect(getCurrentDatabase()).resolves.toEqual({
    id: 'OBJ-ITINVENT',
    name: 'OBJ',
    access: undefined,
    source: 'assigned',
    locked: true,
  });
});

it('ignores the switch response and re-reads the authoritative current database', async () => {
  client.post.mockResolvedValueOnce({ data: { database: { password: 'must-not-be-consumed' } } });
  client.get.mockResolvedValueOnce({ data: { id: 'ITINVENT', name: 'Main', source: 'user_selection', locked: 'false' } });
  await expect(switchDatabase(' ITINVENT ')).resolves.toMatchObject({ id: 'ITINVENT', locked: false });
  expect(client.post).toHaveBeenCalledWith('/database/switch', { database_id: 'ITINVENT' });
  expect(client.get).toHaveBeenCalledWith('/database/current');
});

it('uses the confirmed switch result without a racy second read', async () => {
  client.post.mockResolvedValueOnce({
    data: { database: { id: 'OBJ-ITINVENT', name: 'Объекты', access: 'read-only', password: 'ignored' } },
  });

  await expect(switchDatabase('OBJ-ITINVENT')).resolves.toEqual({
    id: 'OBJ-ITINVENT',
    name: 'Объекты',
    access: 'read-only',
    source: 'user_selection',
    locked: false,
  });
  expect(client.get).not.toHaveBeenCalled();
});

it('normalizes mixed legacy equipment fields from universal search', async () => {
  client.get.mockResolvedValueOnce({
    data: {
      equipment: [{
        INV_NO: 'INV-1',
        SERIAL_NO: 'SN-1',
        MODEL_NAME: 'OptiPlex',
        employee_name: 'Иванов И.И.',
        LOCATION: 'Кабинет 12',
        IP_ADDRESS: '10.0.0.7',
      }],
      total: 1,
      page: 1,
      pages: 1,
    },
  });
  const result = await searchEquipment(' opti ', 1, 25);
  expect(client.get).toHaveBeenCalledWith('/equipment/search/universal', { params: { q: 'opti', page: 1, limit: 25 } });
  expect(result.equipment[0]).toMatchObject({
    inv_no: 'INV-1',
    serial_no: 'SN-1',
    model_name: 'OptiPlex',
    employee_name: 'Иванов И.И.',
    location_name: 'Кабинет 12',
    ip_address: '10.0.0.7',
  });
});

it('browses a request-scoped equipment page without a search query', async () => {
  client.get.mockResolvedValueOnce({ data: { equipment: [{ INV_NO: 'INV-2' }], total: 51, page: 2, pages: 3 } });
  await expect(listEquipment(2, 25, 'OBJ-ITINVENT')).resolves.toMatchObject({ total: 51, page: 2, pages: 3 });
  expect(client.get).toHaveBeenCalledWith('/equipment/database', {
    params: { page: 2, limit: 25 },
    headers: { 'X-Database-ID': 'OBJ-ITINVENT' },
  });
});

it('updates only allowlisted equipment fields in the selected database', async () => {
  client.patch.mockResolvedValueOnce({ data: { INV_NO: 'INV/2', SERIAL_NO: 'SN-NEW', DESCRIPTION: 'Updated' } });
  await expect(updateEquipment('INV/2', { serial_no: ' SN-NEW ', description: ' Updated ' }, 'OBJ-ITINVENT'))
    .resolves.toMatchObject({ inv_no: 'INV/2', serial_no: 'SN-NEW', description: 'Updated' });
  expect(client.patch).toHaveBeenCalledWith('/equipment/INV%2F2', {
    serial_no: 'SN-NEW',
    description: 'Updated',
  }, { headers: { 'X-Database-ID': 'OBJ-ITINVENT' } });
});

it('validates and updates consumable quantity request-scoped', async () => {
  client.patch.mockResolvedValueOnce({ data: { qty_old: 3, qty_new: 5 } });
  await expect(updateConsumableQuantity({ id: 11, inv_no: 'C-11' }, 5, 'OBJ-ITINVENT')).resolves.toMatchObject({ qty_new: 5 });
  expect(client.patch).toHaveBeenCalledWith('/equipment/consumables/qty', {
    item_id: 11,
    inv_no: 'C-11',
    qty: 5,
  }, { headers: { 'X-Database-ID': 'OBJ-ITINVENT' } });
});

it('encodes equipment identifiers for detail, acts and history routes', async () => {
  client.get
    .mockResolvedValueOnce({ data: { inv_no: 'INV/100 A', model_name: 'Laptop' } })
    .mockResolvedValueOnce({ data: { inv_no: 'INV/100 A', total: 0, acts: [] } })
    .mockResolvedValueOnce({ data: { inv_no: 'INV/100 A', total: 1, history: [{ CH_USER: 'admin' }] } });
  await getEquipment('INV/100 A', 'OBJ-ITINVENT');
  await getEquipmentActs('INV/100 A', 'OBJ-ITINVENT');
  const history = await getEquipmentHistory('INV/100 A', 'OBJ-ITINVENT');
  const scoped = { headers: { 'X-Database-ID': 'OBJ-ITINVENT' } };
  expect(client.get).toHaveBeenNthCalledWith(1, '/equipment/INV%2F100%20A', scoped);
  expect(client.get).toHaveBeenNthCalledWith(2, '/equipment/INV%2F100%20A/acts', scoped);
  expect(client.get).toHaveBeenNthCalledWith(3, '/equipment/INV%2F100%20A/history', scoped);
  expect(history.history).toEqual([{ CH_USER: 'admin' }]);
});

it('normalizes the global act feed and keeps file capability', async () => {
  client.get.mockResolvedValueOnce({
    data: {
      query: '77',
      total: 1,
      truncated: false,
      acts: [{ DOC_NO: 77, DOC_NUMBER: 'A-77', HAS_FILE: 1, ITEMS: [{ INV_NO: 'INV-1' }] }],
    },
  });
  const result = await searchEquipmentActs(' 77 ', 50, 'OBJ-ITINVENT');
  expect(client.get).toHaveBeenCalledWith('/equipment/acts/search', {
    params: { q: '77', limit: 50 },
    headers: { 'X-Database-ID': 'OBJ-ITINVENT' },
  });
  expect(result.acts[0]).toMatchObject({ doc_no: 77, doc_number: 'A-77', has_file: true, items: [{ inv_no: 'INV-1', item_id: null, model_name: '', serial_no: '' }] });
});

it('normalizes consumables and marks a limited result as truncated', async () => {
  client.get.mockResolvedValueOnce({
    data: [{ ID: 11, INV_NO: 'C-11', TYPE_NAME: 'Картридж', MODEL_NAME: 'HP 12A', QTY: '3', LOCATION: 'Склад' }],
  });
  const result = await listConsumables({ onlyPositiveQty: true, limit: 1, databaseId: 'OBJ-ITINVENT' });
  expect(client.get).toHaveBeenCalledWith('/equipment/consumables/lookup', {
    params: { only_positive_qty: true, limit: 1 },
    headers: { 'X-Database-ID': 'OBJ-ITINVENT' },
  });
  expect(result).toMatchObject({ total: 1, truncated: true });
  expect(result.consumables[0]).toMatchObject({ id: 11, inv_no: 'C-11', model_name: 'HP 12A', qty: 3, location_name: 'Склад' });
});

it('keeps partial work history when one independent endpoint fails', async () => {
  client.get
    .mockResolvedValueOnce({ data: { count: 2, last_date: '2026-08-20', time_ago_str: '4 дн. назад' } })
    .mockRejectedValueOnce(new Error('component unavailable'));
  const result = await getEquipmentWorkHistories({
    inv_no: 'INV-1',
    serial_no: 'SN-1',
    hw_serial_no: 'HW-1',
  } as never, ['cartridge', 'component']);
  expect(client.get).toHaveBeenNthCalledWith(1, '/json/works/cartridge/history', {
    params: { serial_number: 'SN-1', hw_serial_number: 'HW-1', inv_no: 'INV-1' },
  });
  expect(client.get).toHaveBeenNthCalledWith(2, '/json/works/component/history', {
    params: { serial_number: 'SN-1', hw_serial_number: 'HW-1' },
  });
  expect(result.histories).toEqual([{ kind: 'cartridge', count: 2, last_date: '2026-08-20', time_ago_str: '4 дн. назад' }]);
  expect(result.failed).toEqual(['component']);
  expect(result.unavailable).toEqual([]);
});

it('does not call serial-only work endpoints when the card has no serial numbers', async () => {
  const result = await getEquipmentWorkHistories({ inv_no: 'INV-2', serial_no: '', hw_serial_no: '' } as never, ['battery', 'cleaning']);
  expect(client.get).not.toHaveBeenCalled();
  expect(result).toEqual({ histories: [], unavailable: ['battery', 'cleaning'], failed: [] });
});

it('loads request-scoped creation directories', async () => {
  client.get
    .mockResolvedValueOnce({ data: [{ BRANCH_NO: 'B-1', BRANCH_NAME: 'Филиал' }] })
    .mockResolvedValueOnce({ data: [{ LOC_NO: 4, LOC_NAME: 'Склад' }] });
  await expect(listEquipmentBranches('OBJ')).resolves.toEqual([{ id: 'B-1', name: 'Филиал' }]);
  await expect(listEquipmentLocations('B-1', 'OBJ')).resolves.toEqual([{ id: 4, name: 'Склад' }]);
  expect(client.get).toHaveBeenNthCalledWith(1, '/equipment/branches', { headers: { 'X-Database-ID': 'OBJ' } });
  expect(client.get).toHaveBeenNthCalledWith(2, '/equipment/locations', {
    params: { branch_no: 'B-1' },
    headers: { 'X-Database-ID': 'OBJ' },
  });
});

it('creates and deletes equipment and consumables in the selected database', async () => {
  client.post
    .mockResolvedValueOnce({ data: { success: true, inv_no: 'INV-9', item_id: 9, message: 'created' } })
    .mockResolvedValueOnce({ data: { success: true, inv_no: 'C-9', item_id: 19, message: 'created' } });
  client.delete.mockResolvedValue({ data: { success: true } });
  await createEquipment({
    serial_no: 'SN-9', employee_name: 'Иванов И.И.', branch_no: 1, loc_no: 2,
    type_no: 3, status_no: 4, model_name: 'Model',
  }, 'OBJ');
  await createConsumable({ branch_no: 1, loc_no: 2, type_no: 8, qty: 2, model_name: 'Toner' }, 'OBJ');
  await deleteEquipment('INV/9', 'OBJ');
  await deleteConsumable(19, 'OBJ');
  expect(client.post).toHaveBeenNthCalledWith(1, '/equipment/create', expect.objectContaining({ serial_no: 'SN-9' }), { headers: { 'X-Database-ID': 'OBJ' } });
  expect(client.post).toHaveBeenNthCalledWith(2, '/equipment/consumables/create', expect.objectContaining({ qty: 2 }), { headers: { 'X-Database-ID': 'OBJ' } });
  expect(client.delete).toHaveBeenNthCalledWith(1, '/equipment/INV%2F9', { headers: { 'X-Database-ID': 'OBJ' } });
  expect(client.delete).toHaveBeenNthCalledWith(2, '/equipment/consumables/19', { headers: { 'X-Database-ID': 'OBJ' } });
});

it('submits a stable background transfer contract and normalizes generated acts', async () => {
  client.post.mockResolvedValueOnce({
    data: {
      job_id: 'job-1', operation_id: 'mobile-operation-1', job_status: 'queued',
      success_count: 0, failed_count: 0, acts: [{ act_id: 'act-1', file_name: 'act.pdf', file_type: 'pdf', equipment_count: 1, old_employee: 'A' }],
    },
  });
  await expect(submitEquipmentTransfer('owner', {
    operation_id: 'mobile-operation-1', inv_nos: ['INV-1'], new_employee: 'Петров П.П.',
  }, 'OBJ')).resolves.toMatchObject({
    job_id: 'job-1', operation_id: 'mobile-operation-1', job_status: 'queued',
    acts: [{ act_id: 'act-1', file_type: 'pdf' }],
  });
  expect(client.post).toHaveBeenCalledWith('/equipment/transfer', expect.objectContaining({ operation_id: 'mobile-operation-1' }), { headers: { 'X-Database-ID': 'OBJ' } });
});

it('uploads a PDF to the synchronous recognition contract with the selected database', async () => {
  const originalFormData = global.FormData;
  const append = jest.fn();
  global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
  client.post.mockResolvedValueOnce({
    data: {
      draft_id: 'draft-1', file_name: 'signed.pdf', from_employee: 'Иванов', to_employee: 'Петров',
      doc_date: '2026-08-25 10:00:00', equipment_inv_nos: ['001', '2'], warnings: ['Проверьте номер'],
      resolved_items: [{ item_id: 11, inv_no: '1', model_name: 'PC' }],
    },
  });
  try {
    await expect(parseUploadedEquipmentAct({
      uri: 'file:///cache/signed.pdf', name: 'signed.pdf', mimeType: 'application/pdf', size: 1024,
    }, { manualMode: true, databaseId: 'OBJ' })).resolves.toMatchObject({
      draft_id: 'draft-1', equipment_inv_nos: ['001', '2'], resolved_items: [{ item_id: 11, inv_no: '1' }],
    });
    expect(append).toHaveBeenCalledWith('file', expect.objectContaining({
      uri: 'file:///cache/signed.pdf', name: 'signed.pdf', type: 'application/pdf',
    }));
    expect(client.post).toHaveBeenCalledWith('/equipment/acts/upload/parse', expect.anything(), {
      params: { manual_mode: true },
      headers: { 'X-Database-ID': 'OBJ', 'Content-Type': 'multipart/form-data' },
      timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
    });
  } finally {
    global.FormData = originalFormData;
  }
});

it('reads and commits an uploaded act draft without inventing polling or idempotency headers', async () => {
  client.get.mockResolvedValueOnce({ data: { draft_id: 'draft/1', file_name: 'signed.pdf', equipment_inv_nos: ['1'] } });
  client.post.mockResolvedValueOnce({
    data: {
      success: true, doc_no: 77, doc_number: 'A-77', file_no: 88,
      linked_item_ids: [11], linked_inv_nos: ['1'], message: 'Записан', reminder_pending_groups: 0,
    },
  });
  await expect(getUploadedEquipmentActDraft('draft/1', 'OBJ')).resolves.toMatchObject({ draft_id: 'draft/1' });
  await expect(commitUploadedEquipmentAct({
    draft_id: 'draft/1', from_employee: ' Иванов ', equipment_inv_nos: ['1', '1'],
  }, 'OBJ')).resolves.toMatchObject({ doc_no: 77, file_no: 88, linked_inv_nos: ['1'] });
  expect(client.get).toHaveBeenCalledWith('/equipment/acts/upload/draft/draft%2F1', { headers: { 'X-Database-ID': 'OBJ' } });
  expect(client.post).toHaveBeenCalledWith('/equipment/acts/upload/commit', {
    draft_id: 'draft/1',
    from_employee: 'Иванов',
    to_employee: undefined,
    doc_date: undefined,
    equipment_inv_nos: ['1'],
    source_task_id: undefined,
    reminder_id: undefined,
  }, { headers: { 'X-Database-ID': 'OBJ' } });
});

it('loads recent equipment snapshots and records a cleaning natively', async () => {
  client.get.mockResolvedValueOnce({
    data: { items: [{ inv_no: 'INV-1', db_id: 'OBJ', last_action: 'view', last_action_label: 'Просмотр', activity_count: 2, snapshot: { INV_NO: 'INV-1', MODEL_NAME: 'PC' } }] },
  });
  await expect(listRecentEquipmentCards(8, 'OBJ')).resolves.toEqual([
    expect.objectContaining({ inv_no: 'INV-1', activity_count: 2, snapshot: expect.objectContaining({ model_name: 'PC' }) }),
  ]);
  client.post.mockResolvedValueOnce({ data: { timestamp: 'now' } });
  await recordEquipmentWork({
    kind: 'cleaning', databaseId: 'OBJ', equipment: {
      id: 5, inv_no: 'INV-1', serial_no: 'SN-1', branch_name: 'Филиал', location_name: 'Кабинет',
      employee_name: 'Иванов', type_name: 'Системный блок', model_name: 'PC', vendor_name: 'Dell',
      hw_serial_no: '', part_no: '', status_name: '', employee_dept: '', employee_email: '', ip_address: '',
      mac_address: '', network_name: '', domain_name: '', description: '', hub_db_id: '', hub_db_name: '', raw: {},
    },
  });
  expect(client.post).toHaveBeenCalledWith('/json/works/cleaning', expect.objectContaining({ serial_number: 'SN-1', db_name: 'OBJ' }));
});
