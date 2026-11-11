import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABOUT_RETURN_TO_STORAGE_KEY,
  consumePostAuthReturnPath,
  needsAboutOnboarding,
  normalizeInternalReturnPath,
  rememberPostAuthReturnPath,
  resolvePostAuthenticationPath,
} from './aboutOnboarding';

describe('about onboarding navigation', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('starts onboarding only for an explicit null value', () => {
    expect(needsAboutOnboarding({ about_onboarding_completed_at: null })).toBe(true);
    expect(needsAboutOnboarding({ about_onboarding_completed_at: '2026-08-13T10:00:00Z' })).toBe(false);
    expect(needsAboutOnboarding({})).toBe(false);
    expect(needsAboutOnboarding(null)).toBe(false);
  });

  it('accepts only internal return paths', () => {
    expect(normalizeInternalReturnPath('/shared-files/token?preview=1#page')).toBe('/shared-files/token?preview=1#page');
    expect(normalizeInternalReturnPath('https://attacker.example/tasks')).toBe('');
    expect(normalizeInternalReturnPath('//attacker.example/tasks')).toBe('');
    expect(normalizeInternalReturnPath('/\\attacker.example')).toBe('');
    expect(normalizeInternalReturnPath('/login')).toBe('');
    expect(normalizeInternalReturnPath('/about')).toBe('');
  });

  it('keeps the return path while onboarding is pending and consumes it afterwards', () => {
    rememberPostAuthReturnPath('/tasks?filter=mine');

    expect(resolvePostAuthenticationPath({ about_onboarding_completed_at: null })).toBe('/about');
    expect(window.sessionStorage.getItem(ABOUT_RETURN_TO_STORAGE_KEY)).toBe('/tasks?filter=mine');
    expect(consumePostAuthReturnPath()).toBe('/tasks?filter=mine');
    expect(window.sessionStorage.getItem(ABOUT_RETURN_TO_STORAGE_KEY)).toBeNull();
  });
});
