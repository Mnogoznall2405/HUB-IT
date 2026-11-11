import type { HubUser } from '../api/types';

export function getGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export function getFirstName(user: HubUser | null | undefined): string {
  const explicitFirstName = String(user?.first_name || '').trim();
  if (explicitFirstName) return explicitFirstName;
  const value = String(user?.full_name || user?.display_name || user?.username || '').trim();
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return parts[1];
  return parts[0] || 'коллега';
}

export function formatAbsenceRange(item: { starts_on?: string | null; ends_on?: string | null }): string {
  const start = String(item?.starts_on || '').slice(0, 10);
  const end = String(item?.ends_on || '').slice(0, 10);
  if (!start) return '';
  if (!end || end === start) {
    return new Date(`${start}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  }
  const startLabel = new Date(`${start}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  const endLabel = new Date(`${end}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  return `${startLabel} — ${endLabel}`;
}

export function absenceInitials(name: unknown): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('ru-RU') || '').join('') || '?';
}

export function formatShortDateTime(value: unknown): string {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDueLabel(value: unknown, now = new Date()): string {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return 'Без срока';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 0) {
    return `Просрочено · ${parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}`;
  }
  if (diffDays === 0) return `Сегодня · ${time}`;
  if (diffDays === 1) return `Завтра · ${time}`;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTodayLabel(date = new Date()): string {
  const label = date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label ? `${label.charAt(0).toLocaleUpperCase('ru-RU')}${label.slice(1)}` : '';
}

export function getAccountDisplayName(user: HubUser | null | undefined): string {
  return String(user?.full_name || user?.display_name || user?.username || 'Пользователь').trim();
}

export function getAccountSubtitle(user: HubUser | null | undefined): string {
  const jobTitle = String(user?.job_title || '').trim();
  const department = String(user?.department || '').trim();
  const workContext = [jobTitle, department].filter(Boolean).join(' · ');
  return workContext || String(user?.username || '').trim() || 'HUB-IT';
}

export function getAccountInitials(user: HubUser | null | undefined): string {
  const parts = getAccountDisplayName(user).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'H';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}
