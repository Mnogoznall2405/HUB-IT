import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildApplePasswordsSetupHint,
  isPasswordCredentialSaveSupported,
  offerPasswordCredentialSave,
  offerPasswordSaveForAppleKeychain,
  offerSafariBeaconPasswordSave,
  shouldAutoOfferPasswordCredentialSave,
  shouldAutoOfferPasswordSave,
} from './passwordCredentialSave';

function installIosSafari() {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
}

function createBeaconDocumentMock({ triggerLoad = true } = {}) {
  const submit = vi.fn(() => {
    if (triggerLoad) {
      queueMicrotask(() => loadHandler?.());
    }
  });
  let loadHandler = null;
  const iframe = {
    name: '',
    title: '',
    style: {},
    addEventListener: (event, handler) => {
      if (event === 'load') {
        loadHandler = handler;
      }
    },
    remove: vi.fn(),
  };

  const form = {
    method: '',
    action: '',
    target: '',
    style: {},
    setAttribute: vi.fn(),
    appendChild: vi.fn(),
    submit,
    remove: vi.fn(),
  };

  const createElement = vi.fn((tag) => {
    if (tag === 'iframe') {
      return iframe;
    }
    if (tag === 'form') {
      return form;
    }
    if (tag === 'input') {
      return { type: '', name: '', value: '', autocomplete: '' };
    }
    return {};
  });

  const windowRef = {
    location: { origin: 'https://hubit.zsgp.ru', pathname: '/login' },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
  };

  return {
    submit,
    form,
    iframe,
    windowRef,
    documentRef: {
      createElement,
      body: { appendChild: vi.fn() },
    },
  };
}

describe('passwordCredentialSave', () => {
  afterEach(() => {
    delete window.PasswordCredential;
    delete navigator.credentials;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('detects PasswordCredential store support', () => {
    window.PasswordCredential = class PasswordCredential {};
    navigator.credentials = { store: vi.fn() };
    expect(isPasswordCredentialSaveSupported()).toBe(true);
  });

  it('stores credentials when supported', async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    window.PasswordCredential = vi.fn(function PasswordCredential(init) {
      this.init = init;
    });
    navigator.credentials = { store };

    const result = await offerPasswordCredentialSave({
      username: 'ivanov',
      password: 'secret',
    });

    expect(window.PasswordCredential).toHaveBeenCalledWith({
      id: 'ivanov',
      password: 'secret',
      name: 'ivanov',
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ offered: true, saved: true, method: 'credential_api' });
  });

  it('returns dismissed when user rejects the save prompt', async () => {
    window.PasswordCredential = vi.fn(function PasswordCredential(init) {
      this.init = init;
    });
    navigator.credentials = {
      store: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
    };

    const result = await offerPasswordCredentialSave({
      username: 'ivanov',
      password: 'secret',
    });

    expect(result).toEqual({
      offered: true,
      saved: false,
      reason: 'dismissed',
      method: 'credential_api',
    });
  });

  it('submits parent form into hidden iframe for Safari beacon save', async () => {
    installIosSafari();
    const { submit, form, documentRef, windowRef } = createBeaconDocumentMock({ triggerLoad: true });

    const result = await offerSafariBeaconPasswordSave({
      username: 'ivanov',
      password: 'secret',
      loginChallengeId: 'challenge-1',
      beaconUrl: '/login/save-password',
      documentRef,
      windowRef,
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(form.action).toBe('/login/save-password');
    expect(result).toEqual({
      offered: true,
      saved: false,
      reason: 'beacon_post_ok',
      method: 'safari_beacon',
    });
  });

  it('uses Safari beacon on iPhone when PasswordCredential is unavailable', async () => {
    installIosSafari();
    const { submit, documentRef, windowRef } = createBeaconDocumentMock({ triggerLoad: true });
    vi.spyOn(document, 'createElement').mockImplementation(documentRef.createElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(documentRef.body.appendChild);

    const result = await offerPasswordSaveForAppleKeychain({
      username: 'ivanov',
      password: 'secret',
      loginChallengeId: 'challenge-1',
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('safari_beacon');
    expect(result.reason).toBe('beacon_post_ok');
  });

  it('builds setup hints for saved and unsaved password states', () => {
    expect(buildApplePasswordsSetupHint({ passwordSaved: true })).toMatch(/hubit\.zsgp\.ru/i);
    expect(buildApplePasswordsSetupHint({ passwordSaved: false })).toMatch(/Сначала сохраните пароль/i);
  });

  it('auto-offers on Apple OTP surfaces even without credential store', () => {
    installIosSafari();
    expect(shouldAutoOfferPasswordSave()).toBe(true);
    expect(shouldAutoOfferPasswordCredentialSave()).toBe(true);
  });

  it('auto-offers on Apple OTP surfaces with credential store', () => {
    installIosSafari();
    window.PasswordCredential = class PasswordCredential {};
    navigator.credentials = { store: vi.fn() };
    expect(shouldAutoOfferPasswordSave()).toBe(true);
  });
});
