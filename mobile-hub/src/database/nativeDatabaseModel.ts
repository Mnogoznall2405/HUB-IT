import type {
  ConsumableRecord,
  EquipmentAct,
  EquipmentRecord,
  EquipmentWorkKind,
} from '../api/databaseApi';

export type DatabaseViewMode = 'equipment' | 'consumables' | 'acts';
export type EquipmentDetailTab = 'general' | 'works' | 'acts' | 'history';

const PRINTER_MFU_KEYWORDS = [
  'принтер', 'мфу', 'плоттер', 'плотер', 'printer', 'plotter', 'mfp', 'mfc',
  'large format', 'wide format', 'laserjet', 'officejet', 'deskjet', 'workcentre',
  'versalink', 'i-sensys', 'designjet', 'imageprograf', 'surecolor', 'plotwave',
];
const UPS_KEYWORDS = ['ибп', 'ups', 'uninterruptible', 'power supply'];
const PC_KEYWORDS = ['системный блок', 'системный', 'пк', 'pc', 'system unit'];

function hasShortEquipmentToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => (
    keyword === 'pc' || keyword === 'пк'
      ? hasShortEquipmentToken(text, keyword)
      : text.includes(keyword)
  ));
}

export function equipmentWorkKinds(item: EquipmentRecord): EquipmentWorkKind[] {
  const text = [item.type_name, item.model_name, item.vendor_name].join(' ').toLowerCase();
  const isPrinterOrMfu = hasAnyKeyword(text, PRINTER_MFU_KEYWORDS);
  const isUps = hasAnyKeyword(text, UPS_KEYWORDS);
  const isPc = hasAnyKeyword(text, PC_KEYWORDS);
  return Array.from(new Set<EquipmentWorkKind>([
    ...(isPrinterOrMfu ? ['cartridge' as const, 'component' as const] : []),
    ...(isUps ? ['battery' as const] : []),
    ...(isPc ? ['cleaning' as const] : []),
    ...(isPc && !isPrinterOrMfu ? ['component' as const] : []),
  ]));
}

export function isPrinterLikeEquipment(item: EquipmentRecord | null | undefined): boolean {
  if (!item) return false;
  const text = [item.type_name, item.model_name, item.vendor_name].join(' ').toLowerCase();
  return hasAnyKeyword(text, PRINTER_MFU_KEYWORDS);
}

export function equipmentWorkKindLabel(kind: EquipmentWorkKind): string {
  if (kind === 'cartridge') return 'Замена картриджа';
  if (kind === 'battery') return 'Замена батареи';
  if (kind === 'component') return 'Замена компонентов';
  return 'Чистка компьютера';
}

export type EquipmentIconName =
  | 'monitor'
  | 'laptop'
  | 'printer'
  | 'power-plug-battery-outline'
  | 'phone-classic'
  | 'desktop-tower-monitor'
  | 'devices';

export function equipmentIcon(item: EquipmentRecord): EquipmentIconName {
  const text = [item.type_name, item.model_name].join(' ').toLowerCase();
  if (hasAnyKeyword(text, ['монитор', 'monitor'])) return 'monitor';
  if (hasAnyKeyword(text, ['ноутбук', 'laptop', 'notebook'])) return 'laptop';
  if (isPrinterLikeEquipment(item)) return 'printer';
  if (hasAnyKeyword(text, UPS_KEYWORDS)) return 'power-plug-battery-outline';
  if (hasAnyKeyword(text, ['телефон', 'phone'])) return 'phone-classic';
  if (hasAnyKeyword(text, PC_KEYWORDS)) return 'desktop-tower-monitor';
  return 'devices';
}

export type EquipmentStatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export function equipmentStatusTone(statusName: string | null | undefined): EquipmentStatusTone {
  const text = String(statusName || '').toLowerCase();
  if (!text) return 'neutral';
  if (text.includes('списан') || text.includes('утерян') || text.includes('утилиз')) return 'danger';
  if (text.includes('ремонт')) return 'warning';
  if (text.includes('не использ') || text.includes('не в работе')) return 'neutral';
  if (text.includes('в работе') || text.includes('использ')) return 'success';
  if (text.includes('склад') || text.includes('резерв')) return 'info';
  return 'neutral';
}

const CONSUMABLE_CARTRIDGE_TOKENS = ['картридж', 'катридж', 'тонер', 'cartridge', 'toner'];

export function isCartridgeLikeConsumable(item: ConsumableRecord | null | undefined): boolean {
  if (!item) return false;
  const text = `${item.type_name} ${item.model_name}`.toLocaleLowerCase('ru-RU');
  return CONSUMABLE_CARTRIDGE_TOKENS.some((token) => text.includes(token));
}

export function filterConsumables(items: ConsumableRecord[], query: string): ConsumableRecord[] {
  const normalized = String(query || '').trim().toLocaleLowerCase('ru-RU');
  if (!normalized) return items;
  return items.filter((item) => [
    item.inv_no,
    item.type_name,
    item.model_name,
    item.part_no,
    item.description,
    item.branch_name,
    item.location_name,
  ].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalized)));
}

export type InventoryQrPayload = {
  inventoryNumber: string;
  databaseId: string;
  kind?: 'equipment' | 'consumable';
  itemId?: number;
};

export function parseInventoryQrPayload(value: unknown): InventoryQrPayload | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  try {
    const parsed = new URL(text, 'https://hubit.invalid');
    const isWebLink = ['http:', 'https:'].includes(parsed.protocol)
      && parsed.pathname.replace(/\/+$/, '') === '/database';
    const isAppLink = parsed.protocol === 'hubit:' && parsed.hostname === 'database';
    if (isWebLink || isAppLink) {
      const databaseId = String(parsed.searchParams.get('db_id') || '').trim();
      if (databaseId.length > 100) return null;

      // Consumable QR carries ITEMS.ID — legacy consumable INV_NO can repeat.
      const consumableId = ['consumable', 'consumable_id', 'consumableId']
        .map((key) => String(parsed.searchParams.get(key) || '').trim())
        .find(Boolean) || '';
      if (consumableId) {
        if (!/^\d+$/.test(consumableId)) return null;
        return { kind: 'consumable', itemId: Number(consumableId), inventoryNumber: '', databaseId };
      }

      const inventoryNumber = ['inv_no', 'invNo', 'equipment']
        .map((key) => String(parsed.searchParams.get(key) || '').trim())
        .find(Boolean) || '';
      if (!inventoryNumber || inventoryNumber.length > 200) return null;
      return { kind: 'equipment', inventoryNumber, databaseId };
    }
  } catch {
    // Continue with the established structured or plain inventory payload.
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;

  const match = text.match(/^INV_NO:\s*(.+)$/im);
  if (match) {
    const invNo = String(match[1] || '').trim();
    return invNo === '-' ? null : { kind: 'equipment', inventoryNumber: invNo, databaseId: '' };
  }
  return text.includes('\n') ? null : { kind: 'equipment', inventoryNumber: text, databaseId: '' };
}

export function parseInventoryQrText(value: unknown): string {
  return parseInventoryQrPayload(value)?.inventoryNumber || '';
}

export function equipmentTitle(item: EquipmentRecord): string {
  return item.model_name || item.type_name || `Инв. № ${item.inv_no}`;
}

export function equipmentSubtitle(item: EquipmentRecord): string {
  return [item.type_name, item.vendor_name, item.serial_no ? `S/N ${item.serial_no}` : '']
    .filter(Boolean)
    .join(' · ');
}

export function equipmentLocation(item: EquipmentRecord): string {
  return [item.branch_name, item.location_name].filter(Boolean).join(' · ') || 'Местоположение не указано';
}

export function equipmentOwner(item: EquipmentRecord): string {
  return [item.employee_name, item.employee_dept].filter(Boolean).join(' · ') || 'Сотрудник не назначен';
}

export function equipmentShareText(item: EquipmentRecord): string {
  const line = (label: string, value: unknown): string => {
    const text = String(value ?? '').trim();
    return text ? `${label}: ${text}` : '';
  };
  const identification = [
    equipmentTitle(item),
    line('Инв. №', item.inv_no),
    line('Тип', item.type_name),
    line('Производитель', item.vendor_name),
    line('Статус', item.status_name),
    line('S/N', item.serial_no),
    line('HW S/N', item.hw_serial_no),
    line('P/N', item.part_no),
  ].filter(Boolean).join('\n');
  const placement = [item.branch_name, item.location_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ');
  const owner = String(item.employee_name || '').trim();
  const dept = String(item.employee_dept || '').trim();
  const employeeBlock = [
    owner ? `Сотрудник: ${owner}${dept ? ` (${dept})` : ''}` : '',
    line('E-mail', item.employee_email),
    placement ? `Размещение: ${placement}` : '',
  ].filter(Boolean).join('\n');
  const networkBlock = [
    line('Сетевое имя', item.network_name),
    line('IP', item.ip_address),
    line('MAC', item.mac_address),
    line('Домен', item.domain_name),
  ].filter(Boolean).join('\n');
  const description = String(item.description || '').trim();
  return [identification, employeeBlock, networkBlock, description ? `Описание:\n${description}` : '']
    .filter(Boolean)
    .join('\n\n');
}

export function formatDatabaseDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function equipmentActTitle(act: EquipmentAct): string {
  return act.doc_number ? `Акт ${act.doc_number}` : `Документ № ${act.doc_no}`;
}

export function historyField(row: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

export function historyTitle(row: Record<string, unknown>): string {
  return historyField(row, ['action_name', 'ACTION_NAME', 'operation', 'OPERATION', 'event_name', 'EVENT_NAME', 'ch_comment', 'CH_COMMENT'], 'Изменение карточки');
}

export function historyDescription(row: Record<string, unknown>): string {
  const employee = historyField(row, ['employee_name', 'EMPLOYEE_NAME', 'owner_name', 'OWNER_NAME']);
  const location = historyField(row, ['location_name', 'LOCATION_NAME', 'location', 'LOCATION']);
  const oldEmployee = historyField(row, ['old_employee_name', 'OLD_EMPLOYEE_NAME']);
  const newEmployee = historyField(row, ['new_employee_name', 'NEW_EMPLOYEE_NAME']);
  const change = oldEmployee || newEmployee
    ? [oldEmployee || 'не назначен', newEmployee || 'не назначен'].join(' → ')
    : '';
  const author = historyField(row, ['ch_user', 'CH_USER']);
  return [change, employee, location, author ? `Изменил: ${author}` : ''].filter(Boolean).join(' · ') || 'Подробности не указаны';
}

export function historyDate(row: Record<string, unknown>): string {
  return formatDatabaseDate(historyField(row, ['ch_date', 'CH_DATE', 'date', 'DATE', 'created_at', 'CREATED_AT', 'history_date', 'HISTORY_DATE']));
}

export type EquipmentDraftErrors = Partial<Record<'ip_address' | 'mac_address', string>>;

export function validateEquipmentDraft(draft: { ip_address?: string | null; mac_address?: string | null }): EquipmentDraftErrors {
  const errors: EquipmentDraftErrors = {};
  const ip = String(draft.ip_address ?? '').trim();
  if (ip) {
    const parts = ip.split('.');
    const valid = parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    if (!valid) errors.ip_address = 'IP-адрес: четыре числа 0–255 через точку.';
  }
  const mac = String(draft.mac_address ?? '').trim();
  if (mac && !/^[0-9a-fA-F]{12}$/.test(mac) && !/^[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}$/.test(mac)) {
    errors.mac_address = 'MAC-адрес: 12 hex-символов, разделитель «:» или «-» либо без разделителей.';
  }
  return errors;
}
