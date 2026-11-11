import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  alignOtpAuthAccountName,
  buildAppleFriendlyOtpAuthUri,
  isAppleKeychainOtpSupported,
  isIosDevice,
  toAppleOtpAuthUri,
} from './totpProvisioning';

const ORIGINAL_NAVIGATOR = global.navigator;

function mockNavigator({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      userAgent,
      platform,
      maxTouchPoints,
    },
  });
}

describe('totpProvisioning', () => {
  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: ORIGINAL_NAVIGATOR,
    });
    vi.restoreAllMocks();
  });

  describe('toAppleOtpAuthUri', () => {
    it('replaces otpauth scheme with apple-otpauth', () => {
      const uri = 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru';
      expect(toAppleOtpAuthUri(uri)).toBe(
        'apple-otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru',
      );
    });

    it('returns empty and non-otpauth values unchanged', () => {
      expect(toAppleOtpAuthUri('')).toBe('');
      expect(toAppleOtpAuthUri('https://example.com')).toBe('https://example.com');
    });
  });

  describe('buildAppleFriendlyOtpAuthUri', () => {
    it('uses issuer domain as path label for Apple Passwords matching', () => {
      const uri = 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru&digits=6&period=30';
      expect(buildAppleFriendlyOtpAuthUri(uri, {
        issuerDomain: 'hubit.zsgp.ru',
        accountName: 'ivanov',
      })).toBe(
        'otpauth://totp/hubit.zsgp.ru:ivanov?secret=ABC123&issuer=hubit.zsgp.ru&digits=6&period=30',
      );
    });
  });

  describe('alignOtpAuthAccountName', () => {
    it('replaces account segment with login username for Apple Passwords matching', () => {
      const uri = 'otpauth://totp/HUB-IT:ivanov%40zsgp.ru?secret=ABC123&issuer=hubit.zsgp.ru';
      expect(alignOtpAuthAccountName(uri, 'ivanov')).toBe(
        'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru',
      );
    });

    it('returns original uri when account name is missing', () => {
      const uri = 'otpauth://totp/HUB-IT:ivanov?secret=ABC123&issuer=hubit.zsgp.ru';
      expect(alignOtpAuthAccountName(uri, '')).toBe(uri);
    });

    it('normalizes account case for Apple Passwords matching', () => {
      const uri = 'otpauth://totp/HUB-IT:Ivanov?secret=ABC123&issuer=hubit.zsgp.ru';
      expect(alignOtpAuthAccountName(uri, 'Kozlovskii_me', { normalizeCase: true })).toBe(
        'otpauth://totp/HUB-IT:kozlovskii_me?secret=ABC123&issuer=hubit.zsgp.ru',
      );
    });
  });

  describe('isAppleKeychainOtpSupported', () => {
    it('returns true on iPhone Safari', () => {
      mockNavigator({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      });
      expect(isAppleKeychainOtpSupported()).toBe(true);
      expect(isIosDevice()).toBe(true);
    });

    it('returns true on macOS Safari', () => {
      mockNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      });
      expect(isAppleKeychainOtpSupported()).toBe(true);
      expect(isIosDevice()).toBe(false);
    });

    it('returns false on Windows Chrome', () => {
      mockNavigator({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 0,
      });
      expect(isAppleKeychainOtpSupported()).toBe(false);
      expect(isIosDevice()).toBe(false);
    });
  });
});
