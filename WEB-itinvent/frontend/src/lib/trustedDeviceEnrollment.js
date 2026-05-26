import {
  createPasskeyCredential,
  encodeCredential,
  isPasskeySurfaceAvailable,
} from './passkeyWebAuthn';
import { isWebAuthnApiAvailable } from './useWebAuthnAvailability';

function isWindowsDesktopEnvironment() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = String(navigator.userAgent || '');
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '');
  const isWindows = /windows/i.test(platform) || /windows/i.test(userAgent);
  const isMobile = /android|iphone|ipad|mobile/i.test(userAgent);
  return isWindows && !isMobile;
}

async function isPlatformAuthenticatorAvailable() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    return false;
  }
  const checker = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof checker !== 'function') {
    return false;
  }
  try {
    return Boolean(await checker.call(window.PublicKeyCredential));
  } catch {
    return false;
  }
}

export function normalizeWebAuthnErrorName(error) {
  return String(error?.name || '').trim();
}

export function extractWebAuthnErrorMessage(error, fallbackMessage) {
  const serverDetail = String(error?.response?.data?.detail || '').trim();
  if (serverDetail) {
    return serverDetail;
  }
  const name = normalizeWebAuthnErrorName(error);
  if (name === 'InvalidStateError') {
    return 'Это устройство уже запомнено в системном менеджере passkey. Повторная регистрация не требуется.';
  }
  if (name === 'NotAllowedError') {
    return 'Системное биометрическое подтверждение было отменено или не завершено. Повторите попытку и завершите Face ID, Touch ID или другой системный запрос.';
  }
  if (name === 'SecurityError') {
    return 'WebAuthn доступен только на защищённом адресе приложения. Проверьте, что открыт https://hubit.zsgp.ru.';
  }
  if (name === 'AbortError') {
    return 'Системный запрос на биометрическое подтверждение был прерван. Повторите попытку.';
  }
  if (name === 'NotSupportedError') {
    return 'Этот браузер или способ аутентификации не поддерживает создание доверенного устройства.';
  }
  return String(error?.message || '').trim() || fallbackMessage;
}

export function buildDefaultTrustedDeviceLabel() {
  if (typeof navigator === 'undefined') {
    return 'Доверенное устройство';
  }
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').trim();
  const userAgent = String(navigator.userAgent || '');
  if (/android/i.test(userAgent)) {
    return platform ? `Android (${platform})` : 'Android';
  }
  if (/iphone|ipad/i.test(userAgent)) {
    return platform ? `iOS (${platform})` : 'iOS';
  }
  if (isWindowsDesktopEnvironment()) {
    return 'Windows PC';
  }
  if (platform) {
    return platform;
  }
  return 'Доверенное устройство';
}

export async function resolveTrustedDeviceRegistrationMode() {
  const webAuthnAvailable = isWebAuthnApiAvailable() || await isPasskeySurfaceAvailable();
  if (!webAuthnAvailable) {
    return {
      mode: 'unsupported',
      hint: 'На этом устройстве нельзя создать passkey. Продолжайте входить снаружи через логин, пароль и 2FA.',
      platformOnly: false,
    };
  }
  if (isWindowsDesktopEnvironment()) {
    const available = await isPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        mode: 'unsupported',
        hint: 'Windows Hello не настроен на этом ПК. Сохранение доверенного устройства недоступно, продолжайте входить через TOTP.',
        platformOnly: false,
      };
    }
    return {
      mode: 'platform',
      hint: 'После сохранения этот ПК сможет входить напрямую через Windows Hello без логина, пароля и ручного ввода TOTP.',
      platformOnly: true,
    };
  }
  return {
    mode: 'generic',
    hint: 'Следующий вход на этом устройстве можно будет завершать напрямую через системную биометрию и менеджер passkey без логина, пароля и TOTP.',
    platformOnly: false,
  };
}

export async function registerTrustedDevice({
  authAPI,
  label,
  platformOnly = false,
}) {
  const options = await authAPI.getTrustedDeviceRegistrationOptions(
    String(label || '').trim() || undefined,
    { platformOnly: Boolean(platformOnly) },
  );
  const credential = await createPasskeyCredential(options.public_key);
  await authAPI.verifyTrustedDeviceRegistration(
    options.challenge_id,
    encodeCredential(credential),
    String(label || '').trim() || undefined,
  );
}
