import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailNotifications from './useMailNotifications';

describe('useMailNotifications', () => {
  const renderNotificationsHook = (overrides = {}) => {
    const notifySuccess = vi.fn();
    const notifyInfo = vi.fn();
    const notifyWarning = vi.fn();
    const { result } = renderHook(() => useMailNotifications({
      notifySuccess,
      notifyInfo,
      notifyWarning,
      ...overrides,
    }));
    return { result, notifySuccess, notifyInfo, notifyWarning };
  };

  it('sends mail success and info with source and dedupe defaults', () => {
    const { result, notifySuccess, notifyInfo } = renderNotificationsHook();

    result.current.notifyMailSuccess('Письмо отправлено.');
    result.current.notifyMailInfo('Письмо отправляется…', { durationMs: 4000 });

    expect(notifySuccess).toHaveBeenCalledWith('Письмо отправлено.', {
      source: 'mail',
      dedupeMode: 'none',
    });
    expect(notifyInfo).toHaveBeenCalledWith('Письмо отправляется…', {
      source: 'mail',
      dedupeMode: 'recent',
      durationMs: 4000,
    });
  });

  it('ignores empty success and info text', () => {
    const { result, notifySuccess, notifyInfo } = renderNotificationsHook();

    result.current.notifyMailSuccess('   ');
    result.current.notifyMailInfo(null);

    expect(notifySuccess).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it('routes compose warnings by severity and default titles', () => {
    const { result, notifyInfo, notifyWarning } = renderNotificationsHook();

    result.current.notifyMailComposeWarning({
      message: 'Черновик сохранён локально.',
      severity: 'info',
      id: 'draft-local',
    });
    result.current.notifyMailComposeWarning({
      message: 'Вложение пропущено.',
    });

    expect(notifyInfo).toHaveBeenCalledWith('Черновик сохранён локально.', {
      source: 'mail-compose',
      title: 'Информация',
      dedupeMode: 'recent',
      dedupeKey: 'mail-compose:draft-local',
      durationMs: 4500,
    });
    expect(notifyWarning).toHaveBeenCalledWith('Вложение пропущено.', {
      source: 'mail-compose',
      title: 'Предупреждение',
      dedupeMode: 'recent',
      dedupeKey: 'mail-compose:Вложение пропущено.',
      durationMs: 4500,
    });
  });

  it('does not notify when the compose warning has no message', () => {
    const { result, notifyInfo, notifyWarning } = renderNotificationsHook();

    result.current.notifyMailComposeWarning({ severity: 'info', title: 'Информация' });

    expect(notifyInfo).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });
});
