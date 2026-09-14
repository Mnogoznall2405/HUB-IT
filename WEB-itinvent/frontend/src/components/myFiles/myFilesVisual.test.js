import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  getFileVisualMeta,
  statusChip,
} from './myFilesVisual';

describe('myFilesVisual', () => {
  it('maps file types to visual meta by mime and extension', () => {
    expect(getFileVisualMeta({ download_mime_type: 'image/png' }).label).toBe('Изображение');
    expect(getFileVisualMeta({ download_mime_type: 'application/pdf' }).label).toBe('PDF');
    expect(getFileVisualMeta({ original_file_name: 'a.xlsx' }).label).toBe('Таблица');
    expect(getFileVisualMeta({ original_file_name: 'a.zip' }).label).toBe('Архив');
    expect(getFileVisualMeta({ original_file_name: 'a.py' }).label).toBe('Код');
    expect(getFileVisualMeta({ original_file_name: 'a.bin' }).label).toBe('Файл');
  });

  it('maps item status to chip tone and label', () => {
    expect(statusChip('ready')).toEqual({ label: 'Готов', color: 'success' });
    expect(statusChip('scanning').color).toBe('warning');
    expect(statusChip('failed', 'Стоп-слово').label).toBe('Стоп-слово');
    expect(statusChip('')).toEqual({ label: 'Неизвестно', color: 'default' });
  });

  it('formats ru-RU datetimes and tolerates empties', () => {
    expect(formatDateTime('')).toBe('-');
    expect(formatDateTime('garbage')).toBe('garbage');
    expect(formatDateTime('2026-01-02T10:30:00')).toContain('02');
  });
});
