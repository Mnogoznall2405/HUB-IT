import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./desktopBridge', () => ({
  isDesktopBridgeReady: vi.fn(() => false),
}));

import { isDesktopBridgeReady } from './desktopBridge';
import {
  getMailSessionChoice,
  isMailSessionChoiceRequired,
  isMailSessionEnabled,
  MAIL_SESSION_CHANGED_EVENT,
  setMailSessionChoice,
} from './mailSession';

const USER_LOGIN = 'test.user';

const setStoredUser = (username) => {
  window.localStorage.setItem('user', JSON.stringify({ username }));
};

describe('mailSession', () => {
  beforeEach(() => {
    window.localStorage.clear();
    isDesktopBridgeReady.mockReturnValue(false);
    setStoredUser(USER_LOGIN);
    setMailSessionChoice(null);
  });

  it('keeps mail enabled outside the desktop shell', () => {
    expect(isMailSessionChoiceRequired()).toBe(false);
    expect(isMailSessionEnabled()).toBe(true);
  });

  it('keeps mail enabled outside the desktop shell even after a stored choice', () => {
    setMailSessionChoice('disabled');
    expect(isMailSessionEnabled()).toBe(true);
  });

  it('requires a choice inside the desktop shell and starts disabled', () => {
    isDesktopBridgeReady.mockReturnValue(true);
    expect(isMailSessionChoiceRequired()).toBe(true);
    expect(getMailSessionChoice()).toBeNull();
    expect(isMailSessionEnabled()).toBe(false);
  });

  it('enables mail on this device after the user opts in', () => {
    isDesktopBridgeReady.mockReturnValue(true);
    setMailSessionChoice('enabled');
    expect(getMailSessionChoice()).toBe('enabled');
    expect(isMailSessionEnabled()).toBe(true);
  });

  it('keeps mail off on this device after the user declines', () => {
    isDesktopBridgeReady.mockReturnValue(true);
    setMailSessionChoice('disabled');
    expect(getMailSessionChoice()).toBe('disabled');
    expect(isMailSessionEnabled()).toBe(false);
  });

  it('remembers the choice per login on the same device', () => {
    isDesktopBridgeReady.mockReturnValue(true);
    setMailSessionChoice('enabled', USER_LOGIN);

    setStoredUser('other.user');
    expect(getMailSessionChoice()).toBeNull();
    expect(isMailSessionEnabled()).toBe(false);

    setStoredUser(USER_LOGIN);
    expect(isMailSessionEnabled()).toBe(true);
  });

  it('emits a change event so subscribers can react', () => {
    const listener = vi.fn();
    window.addEventListener(MAIL_SESSION_CHANGED_EVENT, listener);
    setMailSessionChoice('enabled');
    window.removeEventListener(MAIL_SESSION_CHANGED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
