import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatFileSize,
  formatMetricCountPercent,
  formatPercent,
  getInitials,
  getTaskCommentPreview,
  priorityMeta,
  statusMeta,
  toDateInput,
  toDateTimeInput,
} from './taskFormatters';

describe('taskFormatters', () => {
  it('maps task statuses to labels and colors', () => {
    expect(statusMeta('new').label).toBe('Новое');
    expect(statusMeta('done').label).toBe('Готово');
    expect(statusMeta('unknown').label).toBe('unknown');
  });

  it('resolves priority metadata with fallback', () => {
    expect(priorityMeta('urgent').label).toBe('Срочный');
    expect(priorityMeta('missing').label).toBe('Обычный');
  });

  it('formats dates and file sizes', () => {
    expect(formatDateTime('')).toBe('-');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(getInitials('Иван Петров')).toBe('ИП');
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatMetricCountPercent(3, 50)).toBe('3 / 50.0%');
  });

  it('converts datetime values for inputs', () => {
    const iso = '2026-06-13T10:30:00.000Z';
    expect(toDateInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toDateTimeInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('builds comment preview with author', () => {
    expect(getTaskCommentPreview({
      latest_comment_preview: 'Проверьте',
      latest_comment_full_name: 'Иванов',
    })).toBe('Иванов: Проверьте');
    expect(getTaskCommentPreview({ latest_comment_preview: 'Без автора' })).toBe('Без автора');
  });
});
