import type { ComputerRecord, ComputerStatus } from '../api/computersApi';

export const COMPUTER_STATUS_OPTIONS: Array<{ id: '' | ComputerStatus; label: string }> = [
  { id: '', label: 'Все' },
  { id: 'online', label: 'В сети' },
  { id: 'stale', label: 'Давно не было' },
  { id: 'offline', label: 'Не в сети' },
  { id: 'unknown', label: 'Неизвестно' },
];

export function computerStatusLabel(status: ComputerStatus | string): string {
  if (status === 'online') return 'В сети';
  if (status === 'stale') return 'Давно не было';
  if (status === 'offline') return 'Не в сети';
  return 'Неизвестно';
}

export function computerStatusTone(status: ComputerStatus | string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'online') return 'success';
  if (status === 'stale') return 'warning';
  if (status === 'offline') return 'error';
  return 'muted';
}

export function mergeComputerPage(current: ComputerRecord[], incoming: ComputerRecord[]): ComputerRecord[] {
  const byKey = new Map<string, ComputerRecord>();
  for (const item of [...current, ...incoming]) {
    const key = (item.mac_address || item.hostname).trim().toLowerCase();
    if (key) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function numericTimestamp(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? (parsed > 10_000_000_000 ? parsed : parsed * 1000) : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatComputerTimestamp(value: string | number): string {
  const timestamp = numericTimestamp(value);
  if (timestamp === null) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatComputerAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'давность неизвестна';
  if (seconds < 60) return 'только что';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ч назад`;
  return `${Math.floor(seconds / 86_400)} дн назад`;
}

export function formatComputerBytes(value: number): string {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function formatComputerUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'Нет данных';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  if (days > 0) return `${days} дн ${hours} ч`;
  return `${hours} ч`;
}

export function computerDiskWarningCount(computer: ComputerRecord): number {
  return [...computer.logical_disks, ...computer.storage].filter((disk) => {
    const status = disk.health_status.trim().toLowerCase();
    if (status && !['ok', 'healthy', 'good', 'unknown'].includes(status)) return true;
    if (disk.free_gb !== null && disk.total_gb !== null && disk.total_gb > 0) {
      return disk.free_gb / disk.total_gb < 0.1;
    }
    return false;
  }).length;
}

