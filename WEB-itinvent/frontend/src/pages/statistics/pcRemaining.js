export function filterRemainingPcs(items, query) {
  const list = Array.isArray(items) ? items : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((row) => {
    const haystack = [
      row?.inv_no,
      row?.serial_no,
      row?.hw_serial_no,
      row?.location,
      row?.model_name,
      row?.employee,
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function readRemainingPcs(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.remaining_pcs)) return payload.remaining_pcs;
  if (Array.isArray(payload?.data?.remaining_pcs)) return payload.data.remaining_pcs;
  return [];
}

export function remainingPcKey(row, index = 0) {
  return `${String(row?.inv_no || '').trim()}|${String(row?.serial_no || row?.hw_serial_no || '').trim()}|${index}`;
}

export function readSelectedDatabaseId() {
  try {
    return String(window.localStorage.getItem('selected_database') || '').trim();
  } catch {
    return '';
  }
}

export function buildPcCleaningPayload(row, { branch, dbName } = {}) {
  const serialNumber = String(row?.serial_no || row?.hw_serial_no || '').trim();
  const branchName = String(branch || row?.branch || '').trim();
  const location = String(row?.location || '').trim() || 'Не указано';
  if (!serialNumber) {
    return { error: 'У ПК нет серийного номера — чистку поставить нельзя' };
  }
  if (!branchName) {
    return { error: 'Не указан филиал' };
  }

  const equipmentId = Number(row?.equipment_id);
  const payload = {
    serial_number: serialNumber,
    employee: String(row?.employee || '').trim() || 'Не указан',
    branch: branchName,
    location,
    inv_no: String(row?.inv_no || '').trim() || undefined,
    db_name: String(dbName || '').trim() || undefined,
    hw_serial_no: String(row?.hw_serial_no || '').trim() || undefined,
    model_name: String(row?.model_name || '').trim() || undefined,
    manufacturer: String(row?.manufacturer || '').trim() || undefined,
    current_description: String(row?.current_description || '').trim() || undefined,
  };
  if (Number.isFinite(equipmentId) && equipmentId > 0) {
    payload.equipment_id = equipmentId;
  }
  return { payload };
}

