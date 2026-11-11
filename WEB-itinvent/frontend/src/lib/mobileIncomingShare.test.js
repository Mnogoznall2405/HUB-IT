import { describe, expect, it } from 'vitest';
import {
  buildTaskDraftFromMobileIncomingShare,
  consumeMobileIncomingShare,
  normalizeMobileIncomingShare,
} from './mobileIncomingShare';

const payload = {
  schemaVersion: 1,
  id: 'share-1',
  target: 'mail',
  text: 'https://example.com/report',
  subject: 'Отчёт',
  receivedAt: 1_787_400_000_000,
};

describe('mobileIncomingShare', () => {
  it('accepts only a versioned supported target payload', () => {
    expect(normalizeMobileIncomingShare(payload)).toEqual(payload);
    expect(normalizeMobileIncomingShare({ ...payload, target: 'task' })).toEqual({ ...payload, target: 'task' });
    expect(normalizeMobileIncomingShare({ ...payload, schemaVersion: 2 })).toBeNull();
    expect(normalizeMobileIncomingShare({ ...payload, target: 'script' })).toBeNull();
    expect(normalizeMobileIncomingShare({ ...payload, text: '' })).toBeNull();
  });

  it('consumes a payload exactly once only inside the APK WebView', () => {
    const runtimeWindow = {
      __HUBIT_MOBILE_APP__: true,
      __HUBIT_MOBILE_INCOMING_SHARE__: payload,
    };
    expect(consumeMobileIncomingShare('mail', runtimeWindow)).toEqual(payload);
    expect(consumeMobileIncomingShare('mail', runtimeWindow)).toBeNull();
  });

  it('does not expose the contract to a normal PWA window', () => {
    expect(consumeMobileIncomingShare('mail', {
      __HUBIT_MOBILE_INCOMING_SHARE__: payload,
    })).toBeNull();
  });

  it('creates a bounded task draft without submitting anything', () => {
    expect(buildTaskDraftFromMobileIncomingShare({
      ...payload,
      target: 'task',
      subject: '',
    })).toEqual({
      title: 'Задача по ссылке',
      description: payload.text,
    });
    expect(buildTaskDraftFromMobileIncomingShare(payload)).toBeNull();
  });
});
