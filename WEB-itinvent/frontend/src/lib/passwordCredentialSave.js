import { emitAgentDebugLog } from './debugClientLog';
import { isAppleKeychainOtpSupported, isIosDevice } from './totpProvisioning';

export const TOTP_RESUME_STORAGE_KEY = 'hubit_totp_resume';

function resolveSafariPasswordBeaconUrl() {
  return '/login/save-password';
}

export function persistTotpResumeState({
  loginChallengeId = '',
  username = '',
  nextStep = 'totp_setup',
} = {}) {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(TOTP_RESUME_STORAGE_KEY, JSON.stringify({
    loginChallengeId: String(loginChallengeId || '').trim(),
    username: String(username || '').trim(),
    nextStep: String(nextStep || 'totp_setup').trim(),
  }));
}

export function shouldOfferSafariPasswordSaveAfterLogin() {
  return isAppleKeychainOtpSupported();
}

export function submitSafariPasswordSaveFullPage({
  username = '',
  password = '',
  loginChallengeId = '',
  documentRef = typeof document !== 'undefined' ? document : null,
} = {}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  const normalizedChallengeId = String(loginChallengeId || '').trim();

  if (!normalizedUsername || !normalizedPassword || !normalizedChallengeId || !documentRef?.body) {
    return { submitted: false, reason: 'missing_credentials' };
  }

  const form = documentRef.createElement('form');
  form.method = 'POST';
  form.action = resolveSafariPasswordBeaconUrl();
  form.setAttribute('autocomplete', 'on');

  const appendField = (name, value, { type = 'text', autoComplete = '' } = {}) => {
    const input = documentRef.createElement('input');
    input.type = type;
    input.name = name;
    input.value = value;
    if (autoComplete) {
      input.autocomplete = autoComplete;
    }
    form.appendChild(input);
  };

  appendField('username', normalizedUsername, { autoComplete: 'username' });
  appendField('password', normalizedPassword, { type: 'password', autoComplete: 'current-password' });
  appendField('login_challenge_id', normalizedChallengeId, { type: 'hidden' });

  documentRef.body.appendChild(form);

  // #region agent log
  emitAgentDebugLog({
    location: 'passwordCredentialSave.js:submitSafariPasswordSaveFullPage',
    message: 'full page password save submit',
    hypothesisId: 'H10',
    data: {
      loginUsername: normalizedUsername,
      hasChallenge: Boolean(normalizedChallengeId),
      target: '_self',
    },
  });
  // #endregion

  form.submit();
  return { submitted: true, reason: 'full_page_post' };
}

export function isPasswordCredentialSaveSupported() {
  if (typeof window === 'undefined') return false;
  if (typeof window.PasswordCredential !== 'function') return false;
  return typeof navigator?.credentials?.store === 'function';
}

export function shouldAutoOfferPasswordSave() {
  if (!isAppleKeychainOtpSupported()) return false;
  return isPasswordCredentialSaveSupported() || isIosDevice();
}

export function shouldAutoOfferPasswordCredentialSave() {
  return shouldAutoOfferPasswordSave();
}

export async function offerPasswordCredentialSave({
  username = '',
  password = '',
} = {}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  if (!normalizedUsername || !normalizedPassword) {
    return { offered: false, saved: false, reason: 'missing_credentials' };
  }
  if (!isPasswordCredentialSaveSupported()) {
    return { offered: false, saved: false, reason: 'unsupported' };
  }

  try {
    const credential = new window.PasswordCredential({
      id: normalizedUsername,
      password: normalizedPassword,
      name: normalizedUsername,
    });
    await navigator.credentials.store(credential);
    return { offered: true, saved: true, method: 'credential_api' };
  } catch (error) {
    const name = String(error?.name || '').trim();
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return { offered: true, saved: false, reason: 'dismissed', method: 'credential_api' };
    }
    return { offered: true, saved: false, reason: 'error', method: 'credential_api', error };
  }
}

export function offerSafariBeaconPasswordSave({
  username = '',
  password = '',
  loginChallengeId = '',
  beaconUrl = resolveSafariPasswordBeaconUrl(),
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');
  const normalizedChallengeId = String(loginChallengeId || '').trim();

  if (!normalizedUsername || !normalizedPassword || !normalizedChallengeId) {
    return Promise.resolve({
      offered: false,
      saved: false,
      reason: 'missing_credentials',
      method: 'safari_beacon',
    });
  }
  if (!documentRef?.body || !windowRef) {
    return Promise.resolve({
      offered: false,
      saved: false,
      reason: 'unsupported',
      method: 'safari_beacon',
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let submitted = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const iframeName = `safari-password-beacon-${Date.now()}`;
    const iframe = documentRef.createElement('iframe');
    iframe.name = iframeName;
    iframe.title = 'password-save-beacon';
    iframe.style.display = 'none';

    const form = documentRef.createElement('form');
    form.method = 'POST';
    form.action = beaconUrl;
    form.target = iframeName;
    form.style.display = 'none';
    form.setAttribute('autocomplete', 'on');

    const appendField = (name, value, { type = 'text', autoComplete = '' } = {}) => {
      const input = documentRef.createElement('input');
      input.type = type;
      input.name = name;
      input.value = value;
      if (autoComplete) {
        input.autocomplete = autoComplete;
      }
      form.appendChild(input);
    };

    appendField('username', normalizedUsername, { autoComplete: 'username' });
    appendField('password', normalizedPassword, { type: 'password', autoComplete: 'current-password' });
    appendField('login_challenge_id', normalizedChallengeId, { type: 'hidden' });

    const cleanup = () => {
      windowRef.setTimeout(() => {
        if (typeof form.remove === 'function') {
          form.remove();
        }
        if (typeof iframe.remove === 'function') {
          iframe.remove();
        }
      }, 4000);
    };

    iframe.addEventListener('load', () => {
      if (!submitted) {
        return;
      }
      // #region agent log
      emitAgentDebugLog({
        location: 'passwordCredentialSave.js:offerSafariBeaconPasswordSave',
        message: 'beacon iframe post response loaded',
        hypothesisId: 'H6',
        data: {
          beaconUrl,
          pageOrigin: windowRef.location?.origin || '',
        },
      });
      // #endregion
      cleanup();
      finish({
        offered: true,
        saved: false,
        reason: 'beacon_post_ok',
        method: 'safari_beacon',
      });
    });

    documentRef.body.appendChild(iframe);
    documentRef.body.appendChild(form);

    // #region agent log
    emitAgentDebugLog({
      location: 'passwordCredentialSave.js:offerSafariBeaconPasswordSave',
      message: 'beacon parent form submit',
      hypothesisId: 'H4',
      data: {
        beaconUrl,
        pagePath: windowRef.location?.pathname || '',
      },
    });
    // #endregion

    submitted = true;
    form.submit();

    windowRef.setTimeout(() => {
      cleanup();
      finish({
        offered: true,
        saved: false,
        reason: 'beacon_timeout',
        method: 'safari_beacon',
      });
    }, 8000);
  });
}

export async function offerPasswordSaveForAppleKeychain({
  username = '',
  password = '',
  loginChallengeId = '',
} = {}) {
  // #region agent log
  emitAgentDebugLog({
    location: 'passwordCredentialSave.js:offerPasswordSaveForAppleKeychain',
    message: 'password save attempt',
    hypothesisId: 'H1',
    data: {
      hasUsername: Boolean(String(username || '').trim()),
      hasPassword: Boolean(String(password || '')),
      hasChallenge: Boolean(String(loginChallengeId || '').trim()),
      credentialApi: isPasswordCredentialSaveSupported(),
      ios: isIosDevice(),
      appleOtp: isAppleKeychainOtpSupported(),
    },
  });
  // #endregion

  if (isPasswordCredentialSaveSupported()) {
    const result = await offerPasswordCredentialSave({ username, password });
    // #region agent log
    emitAgentDebugLog({
      location: 'passwordCredentialSave.js:offerPasswordCredentialSave',
      message: 'credential api result',
      hypothesisId: 'H2',
      data: {
        offered: Boolean(result.offered),
        saved: Boolean(result.saved),
        reason: result.reason || null,
      },
    });
    // #endregion
    return result;
  }

  if (isAppleKeychainOtpSupported()) {
    const result = await offerSafariBeaconPasswordSave({
      username,
      password,
      loginChallengeId,
    });
    // #region agent log
    emitAgentDebugLog({
      location: 'passwordCredentialSave.js:offerSafariBeaconPasswordSave',
      message: 'safari beacon result',
      hypothesisId: 'H3',
      data: {
        offered: Boolean(result.offered),
        saved: Boolean(result.saved),
        reason: result.reason || null,
      },
    });
    // #endregion
    return result;
  }

  return { offered: false, saved: false, reason: 'unsupported' };
}

export function buildApplePasswordsSetupHint({ passwordSaved = false } = {}) {
  if (passwordSaved) {
    return 'Пароль для hubit.zsgp.ru готов. Надёжнее всего: удерживайте QR-код → «Добавить код в Пароли». Кнопка «Добавить в Пароли» работает только если логин в «Паролях» совпадает с введённым здесь.';
  }
  return 'Сначала сохраните пароль кнопкой ниже или подтвердите «Сохранить» в Safari на шаге входа. Затем удерживайте QR-код или нажмите «Пароль уже в Паролях» → «Добавить в Пароли».';
}
