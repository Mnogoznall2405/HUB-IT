import type { ScanCenterSection, ScanDashboard } from '../api/scanCenterApi';

export const SCAN_CENTER_SECTIONS: Array<{
  id: ScanCenterSection;
  label: string;
  icon: 'view-dashboard-outline' | 'shield-alert-outline' | 'alert-circle-outline' | 'access-point' | 'laptop';
}> = [
  { id: 'overview', label: 'Обзор', icon: 'view-dashboard-outline' },
  { id: 'incidents', label: 'Инциденты', icon: 'shield-alert-outline' },
  { id: 'review', label: 'Не проверено', icon: 'alert-circle-outline' },
  { id: 'agents', label: 'Агенты', icon: 'access-point' },
  { id: 'hosts', label: 'Компьютеры', icon: 'laptop' },
];

export function formatScanCount(value: unknown): string {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count >= 100_000) return `${Math.round(count / 1_000)} тыс.`;
  if (count >= 10_000) return `${(count / 1_000).toFixed(1).replace('.0', '')} тыс.`;
  return String(Math.trunc(count));
}

export function formatScanDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function scanSeverityLabel(value: string): string {
  return ({ high: 'Высокая', medium: 'Средняя', low: 'Низкая', none: 'Нет' } as Record<string, string>)[String(value || '').toLowerCase()] || value || 'Не указана';
}

export function scanIncidentStatusLabel(value: string): string {
  const normalized = String(value || '').toLowerCase();
  return ({
    new: 'Новый',
    ack: 'Просмотрен',
    resolved_deleted: 'Файл удалён',
    resolved_clean: 'Проверен, находок нет',
    resolved_moved: 'Файл перемещён',
  } as Record<string, string>)[normalized] || value || 'Статус не указан';
}

export function scanReasonLabel(value: string): string {
  const normalized = String(value || '').trim();
  const known: Record<string, string> = {
    ocr_timeout: 'OCR не завершился вовремя',
    encrypted_pdf: 'Файл защищён паролем',
    unsupported_format: 'Формат пока не поддерживается',
    damaged_file: 'Файл повреждён',
    analysis_incomplete: 'Проверка завершена не полностью',
  };
  return known[normalized.toLowerCase()] || normalized || 'Причина не указана';
}

export type ScanAttentionItem = {
  id: 'incidents' | 'review' | 'agents';
  label: string;
  value: number;
  description: string;
  section: ScanCenterSection;
};

export function buildScanAttentionItems(dashboard: ScanDashboard | null): ScanAttentionItem[] {
  const totals = dashboard?.totals || {};
  const agentsTotal = Number(totals.agents_total || 0);
  const agentsOnline = Number(totals.agents_online || 0);
  const agentsOutdated = Number(totals.agents_outdated || 0);
  const agentsOffline = Math.max(0, agentsTotal - agentsOnline);
  return [
    {
      id: 'incidents',
      label: 'Новые инциденты',
      value: Number(totals.incidents_new || 0),
      description: 'Находки, которые ещё не просмотрены.',
      section: 'incidents',
    },
    {
      id: 'review',
      label: 'Не удалось проверить',
      value: Number(totals.analysis_incomplete || totals.server_pdf_incomplete || 0),
      description: 'Тайм-ауты, повреждённые и зашифрованные файлы.',
      section: 'review',
    },
    {
      id: 'agents',
      label: agentsOutdated > 0 ? 'Нужно обновить агенты' : 'Агенты не в сети',
      value: agentsOutdated || agentsOffline,
      description: agentsOutdated > 0
        ? `Ожидаемая версия: ${dashboard?.expected_agent_version || 'не указана'}.`
        : `На связи ${agentsOnline} из ${agentsTotal}.`,
      section: 'agents',
    },
  ];
}

export function mergeScanPage<T>(current: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const result = [...current];
  const indexByKey = new Map<string, number>();
  result.forEach((item, index) => {
    const key = keyOf(item);
    if (key) indexByKey.set(key, index);
  });
  incoming.forEach((item) => {
    const key = keyOf(item);
    if (!key) return;
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
    } else {
      result[existing] = item;
    }
  });
  return result;
}
