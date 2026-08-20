import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import {
  formatFileSize,
  formatFullDate,
  formatMailSyncedAt,
  formatTime,
  getAvatarColor,
  getInitials,
  getMailRenderedContentSx,
  getSenderDisplay,
  getSenderEmail,
  sumAttachmentSize,
  sumFilesSize,
} from './mailMessagePresentation';

describe('mailMessagePresentation', () => {
  it('formats file sizes in Russian units', () => {
    expect(formatFileSize(0)).toBe('0 Б');
    expect(formatFileSize(-1)).toBe('0 Б');
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(1024)).toBe('1,0 КБ');
    expect(formatFileSize(10 * 1024)).toBe('10 КБ');
    expect(sumFilesSize([{ size: 100 }, { size: 24 }])).toBe(124);
    expect(sumAttachmentSize(null)).toBe(0);
    expect(sumAttachmentSize([{ size: 50 }])).toBe(50);
  });

  it('formats dates, list times and last-sync labels', () => {
    expect(formatFullDate('')).toBe('-');
    expect(formatFullDate('2026-03-31T10:00:00.000Z')).toMatch(/2026/);
    expect(formatTime('')).toBe('');
    expect(formatMailSyncedAt(new Date('2026-08-20T09:04:00'))).toMatch(/Синхронизировано/);
  });

  it('builds initials and a stable avatar color from email', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials('ivan.petrov@example.com')).toBe('IP');
    expect(getInitials('boss@example.com')).toBe('BO');
    expect(getAvatarColor('same@example.com')).toBe(getAvatarColor('same@example.com'));
    expect(getAvatarColor('a@example.com')).not.toBe(getAvatarColor('b@example.com'));
  });

  it('prefers structured sender fields and falls back to the sender string', () => {
    expect(getSenderEmail({
      sender_person: { email: 'person@example.com' },
      sender: 'Fallback <fallback@example.com>',
    })).toBe('person@example.com');
    expect(getSenderEmail({
      sender: 'Boss Name <boss@example.com>',
    })).toBe('boss@example.com');
    expect(getSenderDisplay({
      sender_display: 'Иван',
      sender_email: 'ivan@example.com',
    })).toBe('Иван');
  });

  it('keeps conversation and quoted layout tokens distinct', () => {
    const theme = createTheme();
    const ui = { isDark: false, textPrimary: '#111', textSecondary: '#666', borderSoft: '#ddd', actionBg: '#f5f5f5' };
    const messageSx = getMailRenderedContentSx({ ui, theme, variant: 'message' });
    const conversationSx = getMailRenderedContentSx({ ui, theme, variant: 'conversation' });
    const quotedSx = getMailRenderedContentSx({ ui, theme, variant: 'message', quoted: true });

    expect(messageSx.fontSize).toBe('0.9375rem');
    expect(conversationSx.fontSize).toBe('0.9rem');
    expect(conversationSx.mt).toBe(0.55);
    expect(quotedSx.fontSize).toBe('0.9rem');
    expect(quotedSx.borderTop).toBe('1px solid');
  });
});
