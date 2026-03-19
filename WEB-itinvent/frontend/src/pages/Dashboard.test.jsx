import { describe, expect, it } from 'vitest';

import { getAnnouncementReadSecondaryText, normalizeAnnouncementReadsPayload } from './Dashboard';

describe('Dashboard announcement reads helpers', () => {
  it('normalizes announcement reads payload using backend contract fields', () => {
    const payload = normalizeAnnouncementReadsPayload({
      items: [
        {
          user_id: 2,
          full_name: 'Иван Иванов',
          is_seen: true,
          is_acknowledged: true,
          read_at: '2026-03-17T12:00:00Z',
          acknowledged_at: '2026-03-17T12:05:00Z',
        },
        {
          user_id: 3,
          full_name: 'Петр Петров',
          is_seen: false,
          is_acknowledged: false,
          read_at: '',
          acknowledged_at: '',
        },
      ],
      summary: {
        recipients_total: 2,
        seen_total: 1,
        ack_total: 1,
        pending_ack_total: 1,
      },
    });

    expect(payload.summary.seen_total).toBe(1);
    expect(payload.items[0].is_seen).toBe(true);
    expect(payload.items[0].is_acknowledged).toBe(true);
    expect(payload.items[1].is_seen).toBe(false);
    expect(payload.items[1].is_acknowledged).toBe(false);
  });

  it('builds readable secondary text for seen and unseen recipients', () => {
    const formatDate = (value) => value || '-';

    expect(getAnnouncementReadSecondaryText(
      { is_seen: true, is_acknowledged: true, read_at: 'READ_AT', acknowledged_at: 'ACK_AT' },
      true,
      formatDate,
    )).toBe('Прочитал: READ_AT · Подтвердил: ACK_AT');

    expect(getAnnouncementReadSecondaryText(
      { is_seen: false, is_acknowledged: false, read_at: '', acknowledged_at: '' },
      true,
      formatDate,
    )).toBe('Не открывал · Подтверждение не получено');

    expect(getAnnouncementReadSecondaryText(
      { is_seen: true, is_acknowledged: false, read_at: 'READ_AT', acknowledged_at: '' },
      false,
      formatDate,
    )).toBe('Прочитал: READ_AT');
  });
});
