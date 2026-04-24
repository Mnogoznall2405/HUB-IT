import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { authAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const CANONICAL_HOST = 'hubit.zsgp.ru';
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const DASHBOARD_PATH = '/dashboard';

function isLocalDevelopmentHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function shouldForceCanonicalHost() {
  if (typeof window === 'undefined') return false;
  const hostname = String(window.location.hostname || '').trim().toLowerCase();
  if (import.meta.env.DEV || isLocalDevelopmentHost(hostname)) {
    return false;
  }
  return window.location.protocol !== 'https:' || hostname !== CANONICAL_HOST;
}

function buildCanonicalUrl(pathname = '/', search = '', hash = '') {
  return `${CANONICAL_ORIGIN}${pathname || '/'}${search || ''}${hash || ''}`;
}

function b64urlToBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function bufferToB64url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeCredential(credential) {
  if (!credential) return null;
  const response = credential.response || {};
  return {
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: response.clientDataJSON ? bufferToB64url(response.clientDataJSON) : undefined,
      attestationObject: response.attestationObject ? bufferToB64url(response.attestationObject) : undefined,
      authenticatorData: response.authenticatorData ? bufferToB64url(response.authenticatorData) : undefined,
      signature: response.signature ? bufferToB64url(response.signature) : undefined,
      userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
      transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined,
    },
  };
}

function normalizeRegistrationOptions(publicKey) {
  return {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: b64urlToBuffer(publicKey.user.id),
    },
    excludeCredentials: Array.isArray(publicKey.excludeCredentials)
      ? publicKey.excludeCredentials.map((item) => ({
        ...item,
        id: b64urlToBuffer(item.id),
      }))
      : [],
  };
}

function normalizeAuthenticationOptions(publicKey) {
  const normalized = {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
  };
  if (Array.isArray(publicKey.allowCredentials) && publicKey.allowCredentials.length > 0) {
    normalized.allowCredentials = publicKey.allowCredentials.map((item) => ({
      ...item,
      id: b64urlToBuffer(item.id),
    }));
  }
  return normalized;
}

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

function normalizeWebAuthnErrorName(error) {
  return String(error?.name || '').trim();
}

function extractWebAuthnErrorMessage(error, fallbackMessage) {
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

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

function FaceIdGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className={className}>
      <rect x="16" y="16" width="48" height="48" rx="18" stroke="currentColor" strokeWidth="4" />
      <path d="M27 31v-5m0 0h5m-5 0-6-6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M53 31v-5m0 0h-5m5 0 6-6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 49v5m0 0h5m-5 0-6 6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M53 49v5m0 0h-5m5 0 6 6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31 41c1.5 3.5 5 5 9 5s7.5-1.5 9-5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M34 34h.01M46 34h.01" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function FingerprintGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" className={className}>
      <path d="M27 34c0-7.18 5.82-13 13-13s13 5.82 13 13" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M21 37c0-10.49 8.51-19 19-19s19 8.51 19 19" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" opacity=".78" />
      <path d="M25 43c0 14.36-4 18-4 18" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M40 33c4.97 0 9 4.03 9 9 0 10.3-2.9 20-8 20" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M33 42c0 6.68-1.17 13.18-5 18" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" opacity=".78" />
      <path d="M55 43c0 6.55-1.22 15.96-7 21" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" opacity=".78" />
    </svg>
  );
}

function ShieldGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <path d="M32 8 14 15v14c0 12.7 7.6 22.73 18 27 10.4-4.27 18-14.3 18-27V15L32 8Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="m24 32 6 6 12-14" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeGlyph({ open = false, className = '' }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <path d="M3 12s3.75-6 9-6 9 6 9 6-3.75 6-9 6-9-6-9-6Z" stroke="currentColor" strokeWidth="1.9" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10.58 10.58A2 2 0 0 0 10 12a2 2 0 0 0 3.42 1.42" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.88 5.08A9.77 9.77 0 0 1 12 4.8c5.25 0 9 5.7 9 5.7a18.89 18.89 0 0 1-2.52 3.2M6.62 6.62A18.54 18.54 0 0 0 3 10.5s3.75 5.7 9 5.7c1.37 0 2.65-.23 3.84-.62" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function Spinner({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn('animate-spin', className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  disabled = false,
  autoFocus = false,
  inputMode,
  readOnly = false,
  multiline = false,
  rows = 3,
  endAdornment = null,
  placeholder = ' ',
  inputRef = null,
}) {
  const sharedInputClassName = cn(
    'peer w-full rounded-[18px] border border-white/10 bg-white/[0.065] px-4 pb-3 pt-6 text-[16px] text-white outline-none transition',
    'placeholder-transparent backdrop-blur-md',
    'focus:border-white/25 focus:bg-white/10 focus:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
    endAdornment ? 'pr-12' : '',
    multiline ? 'min-h-[112px] resize-none' : 'h-16',
  );

  const labelClassName = cn(
    'pointer-events-none absolute left-4 top-3 origin-left text-[13px] font-medium tracking-[0.02em] text-white/64 transition-all duration-200',
    'peer-placeholder-shown:top-[20px] peer-placeholder-shown:text-[16px] peer-placeholder-shown:text-white/36',
    'peer-focus:top-3 peer-focus:text-[13px] peer-focus:text-white/68',
  );

  return (
    <label htmlFor={id} className="relative block">
      {multiline ? (
        <textarea
          id={id}
          ref={inputRef}
          aria-label={label}
          className={sharedInputClassName}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode={inputMode}
          readOnly={readOnly}
          rows={rows}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          ref={inputRef}
          aria-label={label}
          className={sharedInputClassName}
          value={value}
          onChange={onChange}
          type={type}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode={inputMode}
          readOnly={readOnly}
          placeholder={placeholder}
        />
      )}
      <span className={labelClassName}>{label}</span>
      {endAdornment ? (
        <span className="absolute inset-y-0 right-4 flex items-center text-white/52">
          {endAdornment}
        </span>
      ) : null}
    </label>
  );
}

function InfoBanner({ tone = 'info', children }) {
  const toneClasses = {
    info: 'border-cyan-400/18 bg-cyan-400/10 text-cyan-50/92',
    success: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-50/92',
    warning: 'border-amber-300/18 bg-amber-300/10 text-amber-50/92',
    error: 'border-rose-400/18 bg-rose-400/10 text-rose-50/92',
  };

  return (
    <div
      role="status"
      className={cn(
        'rounded-[18px] border px-4 py-3 text-sm leading-6 backdrop-blur-md',
        toneClasses[tone] || toneClasses.info,
      )}
    >
      {children}
    </div>
  );
}

function HeroAction({
  title,
  subtitle,
  detail,
  onClick,
  disabled = false,
  busy = false,
  compact = false,
  mode = 'face',
}) {
  const reducedMotion = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="biometric-hero-button"
      className={cn(
        'group relative w-full overflow-hidden rounded-[24px] border border-cyan-200/18 bg-cyan-200/[0.08] p-4 text-left transition',
        'backdrop-blur-xl hover:border-cyan-100/28 hover:bg-cyan-200/[0.12] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60',
        compact ? 'min-h-[124px]' : 'min-h-[148px]',
      )}
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 48px rgba(8,47,73,0.22)',
      }}
    >
      <motion.div
        aria-hidden="true"
        className="absolute right-[-40px] top-[-52px] h-36 w-36 rounded-full bg-cyan-300/18 blur-3xl"
        animate={reducedMotion ? undefined : { scale: [0.96, 1.05, 0.98], opacity: [0.42, 0.78, 0.48] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative z-10 flex h-full items-center gap-4">
        <motion.div
          className="relative flex h-16 w-16 shrink-0 items-center justify-center"
          animate={reducedMotion ? undefined : { scale: busy ? 1 : [1, 1.03, 1] }}
          transition={{ duration: 3.6, repeat: busy ? 0 : Infinity, ease: 'easeInOut' }}
        >
          <motion.div
            className="absolute inset-0 rounded-[22px] border border-white/12 bg-white/[0.08]"
            animate={reducedMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.5, 0.22, 0.5] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-[19px] border border-white/14 bg-white/[0.08] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
            {busy ? (
              <Spinner className="h-7 w-7 text-cyan-100" />
            ) : mode === 'fingerprint' ? (
              <FingerprintGlyph className="h-9 w-9 text-cyan-50" />
            ) : (
              <FaceIdGlyph className="h-9 w-9 text-cyan-50" />
            )}
          </div>
        </motion.div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[1.05rem] font-semibold tracking-[-0.02em] text-white">{title}</div>
          <p className="text-sm leading-5 text-white/66">{subtitle}</p>
          {detail ? <p className="text-xs leading-5 text-white/44">{detail}</p> : null}
        </div>
      </div>
    </button>
  );
}

function Login() {
  const {
    login,
    startTwoFactorSetup,
    verifyTwoFactorSetup,
    verifyTwoFactorLogin,
    startPasskeyLogin,
    verifyPasskeyLogin,
    refreshTrustedDeviceAuth,
    verifyTrustedDeviceAuth,
  } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('password');
  const [loginModeLoading, setLoginModeLoading] = useState(true);
  const [networkZone, setNetworkZone] = useState('external');
  const [biometricLoginEnabled, setBiometricLoginEnabled] = useState(false);
  const [loginChallengeId, setLoginChallengeId] = useState('');
  const [setupData, setSetupData] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustedDeviceAvailable, setTrustedDeviceAvailable] = useState(false);
  const [rememberDeviceOpen, setRememberDeviceOpen] = useState(false);
  const [rememberDeviceRequired, setRememberDeviceRequired] = useState(false);
  const [registeringDevice, setRegisteringDevice] = useState(false);
  const [trustedDeviceBusy, setTrustedDeviceBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState([]);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [totpQrDataUrl, setTotpQrDataUrl] = useState('');
  const [manualTotpOpen, setManualTotpOpen] = useState(false);
  const [copiedTotpValue, setCopiedTotpValue] = useState('');
  const [rememberDeviceMode, setRememberDeviceMode] = useState('generic');
  const [rememberDeviceHint, setRememberDeviceHint] = useState('');
  const [rememberDeviceError, setRememberDeviceError] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordAssistMessage, setPasswordAssistMessage] = useState('');
  const [showVerifyFallback, setShowVerifyFallback] = useState(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const usernameInputRef = useRef(null);
  const passkeyAttemptedRef = useRef(false);
  const authenticatedUserRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  const canUseWebAuthn = typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
  const isWindowsDesktop = useMemo(() => isWindowsDesktopEnvironment(), []);
  const isPasswordSubmitDisabled = loading || !username.trim() || !password.trim();
  const isTwofaSubmitDisabled = loading || !(useBackupCode ? backupCode.trim() : totpCode.trim());
  const rememberDeviceUnsupported = rememberDeviceMode === 'unsupported';
  const canUseTrustedDeviceHero = step === 'password' && networkZone === 'external' && biometricLoginEnabled;
  const keyboardOpen = keyboardInset > 120 || inputFocused;
  const heroCompact = keyboardOpen && step !== 'setup_complete';
  const contentLift = keyboardOpen ? Math.min(Math.max(keyboardInset * 0.35, 56), 156) : 0;
  const shellPaddingBottom = keyboardOpen
    ? 'max(18px, calc(env(safe-area-inset-bottom, 0px) + 8px))'
    : 'max(24px, calc(env(safe-area-inset-bottom, 0px) + 18px))';

  const stepMeta = {
    password: {
      eyebrow: 'Вход',
      title: 'Рабочая среда HUB-IT',
      description: 'Войдите по passkey или используйте логин и пароль.',
    },
    totp_setup: {
      eyebrow: 'Добавить 2FA',
      title: 'Добавьте код входа',
      description: 'Откройте приложение кодов, добавьте аккаунт HUB-IT и введите первый код.',
    },
    totp_verify: {
      eyebrow: 'Код входа',
      title: 'Подтвердите вход',
      description: 'Введите 6 цифр из приложения кодов или backup-код.',
    },
    setup_complete: {
      eyebrow: '2FA включена',
      title: 'Сохраните backup-коды',
      description: 'Эти коды нужны только если приложение кодов недоступно.',
    },
  }[step] || {
    eyebrow: 'Вход',
    title: 'Рабочая среда HUB-IT',
    description: 'Безопасная рабочая среда для внутренних сервисов и коммуникации.',
  };

  const displayStepMeta = step === 'password'
    ? {
      eyebrow: 'Вход',
      title: 'Рабочая среда HUB-IT',
      description: loginModeLoading
        ? 'Определяем доступный способ входа.'
        : networkZone === 'internal'
          ? 'Внутренняя сеть: логин и пароль.'
          : 'Внешний доступ: сначала passkey, затем пароль и 2FA.',
    }
    : stepMeta;

  const stageLabel = {
    password: 'Войти',
    totp_setup: 'Добавить 2FA',
    totp_verify: 'Подтвердить код',
    setup_complete: 'Backup-коды',
  }[step] || 'Войти';
  const networkLabel = loginModeLoading
    ? 'Проверка'
    : networkZone === 'internal'
      ? 'Внутренняя сеть'
      : 'Внешний доступ';
  const methodLabel = loginModeLoading
    ? 'Определяется'
    : canUseTrustedDeviceHero
      ? 'Passkey first'
      : 'Пароль';
  const twofaLabel = step === 'totp_setup'
    ? 'Настройка'
    : step === 'totp_verify'
      ? 'Требуется'
      : step === 'setup_complete'
        ? 'Включена'
        : networkZone === 'external'
          ? 'При входе'
          : 'Не требуется';

  useEffect(() => {
    let cancelled = false;
    const otpauthUri = String(setupData?.otpauth_uri || '').trim();
    if (!otpauthUri) {
      setTotpQrDataUrl('');
      return () => {
        cancelled = true;
      };
    }

    QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setTotpQrDataUrl(String(dataUrl || ''));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTotpQrDataUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setupData?.otpauth_uri]);

  useEffect(() => {
    setManualTotpOpen(false);
    setCopiedTotpValue('');
  }, [setupData?.otpauth_uri, setupData?.manual_entry_key]);

  useEffect(() => {
    if (!shouldForceCanonicalHost()) {
      return;
    }
    window.location.replace(
      buildCanonicalUrl(window.location.pathname, window.location.search, window.location.hash),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLoginMode = async () => {
      try {
        const mode = await authAPI.getLoginMode();
        if (cancelled) {
          return;
        }
        const nextZone = String(mode?.network_zone || '').trim().toLowerCase() === 'internal'
          ? 'internal'
          : 'external';
        const nextBiometric = Boolean(mode?.biometric_login_enabled);
        setNetworkZone(nextZone);
        setBiometricLoginEnabled(nextBiometric);
        setShowPasswordForm(nextZone === 'internal' || !nextBiometric);
      } catch {
        if (cancelled) {
          return;
        }
        setNetworkZone('external');
        setBiometricLoginEnabled(false);
        setShowPasswordForm(true);
      } finally {
        if (!cancelled) {
          setLoginModeLoading(false);
        }
      }
    };

    void loadLoginMode();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateCompact = () => {
      setIsCompactViewport(Boolean(mediaQuery.matches));
    };

    updateCompact();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateCompact);
      return () => mediaQuery.removeEventListener('change', updateCompact);
    }
    mediaQuery.addListener(updateCompact);
    return () => mediaQuery.removeListener(updateCompact);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleFocusIn = (event) => {
      const tag = String(event?.target?.tagName || '').toLowerCase();
      setInputFocused(tag === 'input' || tag === 'textarea');
    };
    const handleFocusOut = () => {
      setTimeout(() => {
        const activeTag = String(document.activeElement?.tagName || '').toLowerCase();
        setInputFocused(activeTag === 'input' || activeTag === 'textarea');
      }, 0);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return undefined;
    }

    const updateViewportInset = () => {
      const viewport = window.visualViewport;
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset);
    };

    updateViewportInset();
    window.visualViewport.addEventListener('resize', updateViewportInset);
    window.visualViewport.addEventListener('scroll', updateViewportInset);
    return () => {
      window.visualViewport.removeEventListener('resize', updateViewportInset);
      window.visualViewport.removeEventListener('scroll', updateViewportInset);
    };
  }, []);

  useEffect(() => {
    setShowVerifyFallback(true);
  }, [step]);

  useEffect(() => {
    if (!showPasswordForm || !usernameInputRef.current) {
      return;
    }
    usernameInputRef.current.focus();
  }, [showPasswordForm]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    if (rememberDeviceOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [rememberDeviceOpen]);

  useEffect(() => {
    if (
      loginModeLoading
      || step !== 'password'
      || networkZone !== 'external'
      || !biometricLoginEnabled
      || showPasswordForm
      || passkeyAttemptedRef.current
    ) {
      return;
    }
    passkeyAttemptedRef.current = true;
    void attemptPasskeyLogin({ auto: true });
  }, [loginModeLoading, step, networkZone, biometricLoginEnabled, showPasswordForm]);

  const redirectToDashboard = () => {
    if (shouldForceCanonicalHost()) {
      window.location.assign(buildCanonicalUrl(DASHBOARD_PATH));
      return;
    }
    window.location.assign(DASHBOARD_PATH);
  };

  const closeRememberDevicePrompt = ({ redirect = true } = {}) => {
    setRememberDeviceOpen(false);
    setRememberDeviceRequired(false);
    setRegisteringDevice(false);
    setRememberDeviceHint('');
    setRememberDeviceError('');
    setRememberDeviceMode('generic');
    setDeviceLabel('');
    if (redirect) {
      redirectToDashboard();
    }
  };

  const dismissRememberDevicePrompt = () => {
    if (rememberDeviceRequired && !rememberDeviceUnsupported) {
      return;
    }
    closeRememberDevicePrompt();
  };

  const maybeOpenRememberDevicePrompt = async (enabled) => {
    setRememberDeviceError('');
    if (!enabled || !canUseWebAuthn) {
      redirectToDashboard();
      return;
    }

    if (isWindowsDesktop) {
      const available = await isPlatformAuthenticatorAvailable();
      if (!available) {
        setRememberDeviceMode('unsupported');
        setRememberDeviceHint('Windows Hello не настроен на этом ПК. Сохранение доверенного устройства недоступно, продолжайте входить через TOTP.');
        setRememberDeviceOpen(true);
        return;
      }
      setRememberDeviceMode('platform');
      setRememberDeviceHint('После сохранения этот ПК сможет входить напрямую через Windows Hello без логина, пароля и ручного ввода TOTP.');
      setRememberDeviceOpen(true);
      return;
    }

    setRememberDeviceMode('generic');
    setRememberDeviceHint('Следующий вход на этом устройстве можно будет завершать напрямую через системную биометрию и менеджер passkey без логина, пароля и TOTP.');
    setRememberDeviceOpen(true);
  };

  const openRememberDevicePrompt = async ({ enabled, required = false } = {}) => {
    setRememberDeviceError('');
    setRememberDeviceRequired(Boolean(required));
    if (!enabled) {
      redirectToDashboard();
      return;
    }
    if (!canUseWebAuthn) {
      if (!required) {
        redirectToDashboard();
        return;
      }
      setRememberDeviceMode('unsupported');
      setRememberDeviceHint('На этом устройстве нельзя создать passkey. Продолжайте входить снаружи через логин, пароль и 2FA.');
      setRememberDeviceOpen(true);
      return;
    }

    if (isWindowsDesktop) {
      const available = await isPlatformAuthenticatorAvailable();
      if (!available) {
        setRememberDeviceMode('unsupported');
        setRememberDeviceHint('Windows Hello не настроен на этом ПК. Сохранение доверенного устройства недоступно, продолжайте входить снаружи через пароль и 2FA.');
        setRememberDeviceOpen(true);
        return;
      }
      setRememberDeviceMode('platform');
      setRememberDeviceHint('После сохранения этот ПК сможет входить напрямую через Windows Hello без логина, пароля и ручного ввода TOTP.');
      setRememberDeviceOpen(true);
      return;
    }

    setRememberDeviceMode('generic');
    setRememberDeviceHint('Следующий вход на этом устройстве можно будет завершать напрямую через системную биометрию и менеджер passkey без логина, пароля и TOTP.');
    setRememberDeviceOpen(true);
  };

  const revealPasswordFallback = (message = '') => {
    setShowPasswordForm(true);
    setPasswordAssistMessage(String(message || ''));
  };

  const attemptPasskeyLogin = async ({ auto = false } = {}) => {
    if (step !== 'password') {
      return false;
    }
    setError(null);
    if (!auto) {
      setPasswordAssistMessage('');
    }
    if (!canUseWebAuthn) {
      revealPasswordFallback(
        auto ? '' : 'На этом устройстве системный passkey недоступен. Продолжите вход по логину и паролю.',
      );
      return false;
    }
    setTrustedDeviceBusy(true);
    const optionsResult = await startPasskeyLogin();
    if (!optionsResult.success) {
      setTrustedDeviceBusy(false);
      revealPasswordFallback(
        auto
          ? 'Автоматический вход по passkey не сработал. Продолжите вход по логину и паролю.'
          : (optionsResult.error || 'Не удалось начать вход по биометрии. Продолжите по логину и паролю.'),
      );
      return false;
    }

    try {
      const credential = await navigator.credentials.get({
        publicKey: normalizeAuthenticationOptions(optionsResult.public_key),
      });
      const verifyResult = await verifyPasskeyLogin(
        optionsResult.challenge_id,
        encodeCredential(credential),
      );
      setTrustedDeviceBusy(false);
      if (!verifyResult.success) {
        revealPasswordFallback(
          auto
            ? 'Passkey на этом устройстве не подтвердил вход. Продолжите вход по логину и паролю.'
            : (verifyResult.error || 'Не удалось завершить вход по биометрии. Продолжите по логину и паролю.'),
        );
        return false;
      }
      redirectToDashboard();
      return true;
    } catch (passkeyError) {
      setTrustedDeviceBusy(false);
      const friendlyMessage = extractWebAuthnErrorMessage(passkeyError, 'Не удалось подтвердить вход по биометрии');
      revealPasswordFallback(
        auto
          ? 'Если passkey на этом устройстве недоступен или не был подтверждён, продолжите вход по логину и паролю.'
          : friendlyMessage,
      );
      return false;
    }
  };

  const shouldRequireTrustedDeviceEnrollment = (userPayload) => (
    networkZone === 'external'
    && Number(userPayload?.discoverable_trusted_devices_count || 0) <= 0
  );

  const completeAuthenticatedRedirect = async (userPayload) => {
    authenticatedUserRef.current = userPayload || null;
    if (shouldRequireTrustedDeviceEnrollment(userPayload)) {
      await openRememberDevicePrompt({ enabled: true, required: true });
      return;
    }
    redirectToDashboard();
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(username.trim(), password);
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    if (result.status === 'authenticated') {
      await completeAuthenticatedRedirect(result.user || null);
      return;
    }

    setLoginChallengeId(result.login_challenge_id || '');
    setTrustedDeviceAvailable(Boolean(result.trusted_devices_available));
    setTotpCode('');
    setBackupCode('');
    setUseBackupCode(false);
    setPasswordAssistMessage('');

    if (result.status === '2fa_setup_required') {
      setLoading(true);
      const setupResult = await startTwoFactorSetup(result.login_challenge_id);
      setLoading(false);
      if (!setupResult.success) {
        setError(setupResult.error);
        return;
      }
      setSetupData(setupResult);
      setStep('totp_setup');
      return;
    }

    setStep('totp_verify');
  };

  const handleVerifySetup = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await verifyTwoFactorSetup(loginChallengeId, totpCode.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    authenticatedUserRef.current = result.user || null;
    setBackupCodes(Array.isArray(result.backup_codes) ? result.backup_codes : []);
    setStep('setup_complete');
  };

  const handleVerifyLogin = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await verifyTwoFactorLogin(
      loginChallengeId,
      useBackupCode
        ? { backup_code: backupCode.trim() }
        : { totp_code: totpCode.trim() },
    );
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    await completeAuthenticatedRedirect(result.user || null);
  };

  const copyTotpSetupValue = async (kind, value) => {
    const text = String(value || '').trim();
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedTotpValue(kind);
    } catch {
      setCopiedTotpValue('');
    }
  };

  const handleTrustedDeviceAuth = async () => {
    setError(null);
    setTrustedDeviceBusy(true);
    const optionsResult = await refreshTrustedDeviceAuth(loginChallengeId);
    if (!optionsResult.success) {
      setTrustedDeviceBusy(false);
      setError(optionsResult.error);
      return;
    }

    try {
      const credential = await navigator.credentials.get({
        publicKey: normalizeAuthenticationOptions(optionsResult.public_key),
      });
      const verifyResult = await verifyTrustedDeviceAuth(
        loginChallengeId,
        optionsResult.challenge_id,
        encodeCredential(credential),
      );
      setTrustedDeviceBusy(false);
      if (!verifyResult.success) {
        setError(verifyResult.error);
        return;
      }
      redirectToDashboard();
    } catch (authError) {
      setTrustedDeviceBusy(false);
      setError(extractWebAuthnErrorMessage(authError, 'Не удалось подтвердить доверенное устройство'));
    }
  };

  const handleRememberDevice = async () => {
    setRegisteringDevice(true);
    setError(null);
    setRememberDeviceError('');
    try {
      const options = await authAPI.getTrustedDeviceRegistrationOptions(
        deviceLabel.trim() || undefined,
        { platformOnly: rememberDeviceMode === 'platform' },
      );
      const credential = await navigator.credentials.create({
        publicKey: normalizeRegistrationOptions(options.public_key),
      });
      await authAPI.verifyTrustedDeviceRegistration(
        options.challenge_id,
        encodeCredential(credential),
        deviceLabel.trim() || undefined,
      );
      closeRememberDevicePrompt();
    } catch (registerError) {
      console.error('Trusted device registration failed:', registerError);
      if (normalizeWebAuthnErrorName(registerError) === 'InvalidStateError') {
        closeRememberDevicePrompt();
        return;
      }
      setRememberDeviceError(extractWebAuthnErrorMessage(registerError, 'Не удалось запомнить устройство'));
      setRegisteringDevice(false);
    }
  };

  const handleSetupCompleteContinue = async () => {
    await completeAuthenticatedRedirect(authenticatedUserRef.current);
  };

  const shellMotion = prefersReducedMotion
    ? {}
    : {
      initial: { opacity: 0, y: 18 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.45, ease: 'easeOut' },
    };

  const primaryButtonClassName = 'flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] !bg-cyan-200 px-5 text-[15px] font-semibold !text-zinc-950 transition hover:!bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-55';
  const secondaryButtonClassName = 'flex min-h-12 w-full items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.045] px-5 text-sm font-semibold text-white/78 transition hover:bg-white/[0.08]';

  const renderStatusRail = () => (
    <aside className="hidden min-h-[620px] flex-col justify-between rounded-[32px] border border-white/10 bg-white/[0.045] p-8 shadow-[0_28px_90px_rgba(2,6,23,0.38)] backdrop-blur-2xl md:flex">
      <div className="space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold tracking-[0.08em] text-white/76">HUB-IT</div>
          <div className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            Защищено
          </div>
        </div>

        <div className="max-w-[38rem] space-y-5">
          <div className="text-[clamp(2.6rem,5vw,5.4rem)] font-semibold leading-[0.96] tracking-[-0.06em] text-white">
            Единый вход в рабочие сервисы
          </div>
          <p className="max-w-[31rem] text-base leading-7 text-white/58">
            Страница входа подбирает сценарий под сеть и устройство: passkey, пароль, 2FA и доверенное устройство остаются в одном потоке.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            ['Сеть', networkLabel],
            ['Способ', methodLabel],
            ['2FA', twofaLabel],
            ['Шаг', stageLabel],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[22px] border border-white/10 bg-black/16 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/36">{label}</div>
              <div className="mt-2 text-sm font-semibold text-white/84">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] border border-cyan-200/14 bg-cyan-200/[0.06] p-5">
        <div className="text-sm font-semibold text-cyan-50">Внешний вход</div>
        <p className="mt-2 text-sm leading-6 text-white/56">
          Снаружи система сначала пробует доверенное устройство. Если его нет, вход завершится паролем и кодом.
        </p>
      </div>
    </aside>
  );

  const renderMobileHeader = () => (
    <motion.div
      className="space-y-4 px-1 md:hidden"
      animate={prefersReducedMotion ? undefined : { scale: heroCompact ? 0.97 : 1, y: heroCompact ? -6 : 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold tracking-[0.08em] text-white/72">HUB-IT</div>
        <div className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs font-semibold text-white/58">
          {networkLabel}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white">
          {displayStepMeta.title}
        </div>
        <p className="text-sm leading-6 text-white/56">
          {displayStepMeta.description}
        </p>
      </div>
    </motion.div>
  );

  const renderNetworkAwarePasswordStep = () => {
    if (loginModeLoading) {
      return (
        <div
          data-testid="login-mode-loading"
          className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-center backdrop-blur-xl"
        >
          <Spinner className="h-8 w-8 text-sky-100" />
          <div className="space-y-2">
            <div className="text-base font-semibold text-white">Определяем режим входа</div>
            <p className="text-sm leading-6 text-white/58">
              Проверяем сеть и доступность passkey.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {canUseTrustedDeviceHero ? (
          <HeroAction
            title={trustedDeviceBusy ? 'Подтверждаем passkey' : 'Войти через passkey'}
            subtitle="Быстрый вход с доверенного телефона или ПК."
            detail="Пароль остается ниже как запасной путь."
            onClick={() => attemptPasskeyLogin({ auto: false })}
            disabled={trustedDeviceBusy || loading}
            busy={trustedDeviceBusy}
            compact={heroCompact}
            mode={isCompactViewport ? 'fingerprint' : 'face'}
          />
        ) : (
          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-cyan-50">
                <ShieldGlyph className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <div className="text-base font-semibold text-white">Логин и пароль</div>
                <p className="text-sm leading-6 text-white/58">
                  {networkZone === 'internal'
                    ? 'Внутренняя сеть входит без 2FA на этом экране.'
                    : 'Если passkey не сработал, завершите вход паролем и кодом.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {passwordAssistMessage ? <InfoBanner tone="info">{passwordAssistMessage}</InfoBanner> : null}

        {canUseTrustedDeviceHero && !showPasswordForm ? (
          <button
            type="button"
            onClick={() => {
              setPasswordAssistMessage('');
              setShowPasswordForm(true);
            }}
            className={secondaryButtonClassName}
          >
            Войти по паролю
          </button>
        ) : null}

        <AnimatePresence initial={false}>
          {(showPasswordForm || !canUseTrustedDeviceHero) ? (
            <motion.form
              key="password-form"
              onSubmit={handlePasswordSubmit}
              data-testid="password-auth-form"
              className="space-y-4"
              initial={prefersReducedMotion ? undefined : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: 10 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              <Field
                id="login-username"
                label="Логин"
                inputRef={usernameInputRef}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={loading}
              />
              <Field
                id="login-password"
                label="Пароль"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={loading}
                endAdornment={(
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label="toggle password visibility"
                    className="rounded-full p-1 text-white/52 transition hover:text-white/86"
                  >
                    <EyeGlyph open={showPassword} className="h-5 w-5" />
                  </button>
                )}
              />
              <button
                type="submit"
                disabled={isPasswordSubmitDisabled}
                className={primaryButtonClassName}
              >
                {loading ? <Spinner className="h-5 w-5" /> : null}
                <span>Войти</span>
              </button>
            </motion.form>
          ) : null}
        </AnimatePresence>
      </div>
    );
  };

  const renderSetupStep = () => {
    const totpSetupUri = String(setupData?.otpauth_uri || '').trim();
    const totpManualKey = String(setupData?.manual_entry_key || '').trim();
    const setupSteps = ['Откройте приложение кодов', 'Добавьте аккаунт', 'Введите 6 цифр'];

    const openAuthenticatorAction = totpSetupUri ? (
      <a
        href={totpSetupUri}
        data-testid="totp-open-authenticator"
        className="flex min-h-14 w-full items-center justify-center rounded-[18px] !bg-cyan-200 px-5 text-center text-[15px] font-semibold !text-zinc-950 !no-underline transition hover:!bg-cyan-100 hover:!no-underline"
      >
        Открыть в приложении кодов
      </a>
    ) : null;

    const qrSetupCard = (
      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
        {totpQrDataUrl ? (
          <div className="flex justify-center rounded-[18px] border border-white/8 bg-white/[0.04] p-4">
            <img
              src={totpQrDataUrl}
              alt="TOTP QR"
              data-testid="totp-qr-image"
              className="h-auto w-full max-w-[220px] rounded-[18px] bg-white p-3"
            />
          </div>
        ) : (
          <InfoBanner tone="warning">
            <span>QR-код не удалось показать автоматически.</span>
            <button
              type="button"
              onClick={() => setManualTotpOpen(true)}
              className="ml-2 font-semibold text-amber-50 underline decoration-amber-100/45 underline-offset-4"
            >
              Добавить вручную
            </button>
          </InfoBanner>
        )}
      </div>
    );

    return (
      <form onSubmit={handleVerifySetup} className="space-y-4">
        <InfoBanner tone="info">
          Добавьте HUB-IT в приложение кодов и введите первый 6-значный код ниже.
        </InfoBanner>

        <div className="grid gap-2 sm:grid-cols-3">
          {setupSteps.map((label, index) => (
            <div key={label} className="rounded-[18px] border border-white/10 bg-white/[0.045] px-4 py-3 text-sm font-medium text-white/82">
              <span className="mr-2 text-white/36">{index + 1}</span>
              {label}
            </div>
          ))}
        </div>

        {isCompactViewport ? openAuthenticatorAction : qrSetupCard}
        {isCompactViewport ? qrSetupCard : openAuthenticatorAction}

        <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
          <button
            type="button"
            data-testid="totp-manual-toggle"
            aria-expanded={manualTotpOpen}
            aria-controls="totp-manual-panel"
            onClick={() => setManualTotpOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-3 text-left text-[15px] font-semibold text-white/86"
          >
            <span>Добавить вручную</span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/42">
              {manualTotpOpen ? 'Скрыть' : 'Открыть'}
            </span>
          </button>

          {manualTotpOpen ? (
            <div id="totp-manual-panel" data-testid="totp-manual-panel" className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/44">Ручной ключ</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1 break-all rounded-[18px] bg-black/20 px-4 py-3 font-mono text-[15px] text-white/88">
                    {totpManualKey || '—'}
                  </div>
                  <button
                    type="button"
                    data-testid="totp-copy-manual-key"
                    disabled={!totpManualKey}
                    onClick={() => {
                      void copyTotpSetupValue('manual', totpManualKey);
                    }}
                    className="min-h-12 rounded-[16px] border border-white/10 px-4 text-sm font-semibold text-white/76 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Скопировать ключ
                  </button>
                </div>
                {copiedTotpValue === 'manual' ? (
                  <div className="mt-2 text-xs font-medium text-emerald-200/88">Ключ скопирован</div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Field
                  id="login-otpauth-uri"
                  label="otpauth URI"
                  value={totpSetupUri}
                  readOnly
                  multiline
                  rows={3}
                />
                <button
                  type="button"
                  data-testid="totp-copy-uri"
                  disabled={!totpSetupUri}
                  onClick={() => {
                    void copyTotpSetupValue('uri', totpSetupUri);
                  }}
                  className="min-h-12 w-full rounded-[16px] border border-white/10 px-4 text-sm font-semibold text-white/76 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Скопировать URI
                </button>
                {copiedTotpValue === 'uri' ? (
                  <div className="text-xs font-medium text-emerald-200/88">URI скопирован</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <Field
          id="login-totp-setup-code"
          label="Код из приложения"
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value)}
          inputMode="numeric"
        />

        <button
          type="submit"
          disabled={isTwofaSubmitDisabled}
          className={primaryButtonClassName}
        >
          {loading ? <Spinner className="h-5 w-5" /> : null}
          <span>Включить 2FA</span>
        </button>
      </form>
    );
  };

  const renderVerifyStep = () => (
    <div className="space-y-4">
      {canUseTrustedDeviceHero ? (
        <HeroAction
          title={trustedDeviceBusy ? 'Подтверждаем passkey' : 'Доверенное устройство'}
          subtitle="Подтвердите вход системным passkey."
          detail="Код можно ввести вручную ниже."
          onClick={handleTrustedDeviceAuth}
          disabled={trustedDeviceBusy || loading}
          busy={trustedDeviceBusy}
          compact={heroCompact}
          mode={isCompactViewport ? 'fingerprint' : 'face'}
        />
      ) : (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.06] text-cyan-50">
              <ShieldGlyph className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <div className="text-base font-semibold text-white">Введите код</div>
              <p className="text-sm leading-6 text-white/58">
                Используйте приложение кодов или backup-код.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setUseBackupCode((prev) => !prev);
            setTotpCode('');
            setBackupCode('');
          }}
          className="text-sm font-medium text-sky-200/88 transition hover:text-sky-100"
        >
          {useBackupCode ? 'Использовать код из приложения' : 'Использовать backup-код'}
        </button>
        {canUseTrustedDeviceHero ? (
          <button
            type="button"
            onClick={() => setShowVerifyFallback((prev) => !prev)}
            aria-expanded={showVerifyFallback}
            className="text-sm font-medium text-white/58 transition hover:text-white/84"
          >
            {showVerifyFallback ? 'Скрыть кодовый сценарий' : 'Ввести код вручную'}
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {(showVerifyFallback || !canUseTrustedDeviceHero) ? (
          <motion.form
            key="verify-form"
            onSubmit={handleVerifyLogin}
            data-testid="verify-fallback-form"
            className="space-y-4"
            initial={prefersReducedMotion ? undefined : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: 10 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <Field
              id="login-totp-verify"
              label={useBackupCode ? 'Backup-код' : 'Код из приложения'}
              value={useBackupCode ? backupCode : totpCode}
              onChange={(event) => {
                if (useBackupCode) {
                  setBackupCode(event.target.value);
                } else {
                  setTotpCode(event.target.value);
                }
              }}
              inputMode={useBackupCode ? 'text' : 'numeric'}
            />
            <button
              type="submit"
              disabled={isTwofaSubmitDisabled}
              className={primaryButtonClassName}
            >
              {loading ? <Spinner className="h-5 w-5" /> : null}
              <span>Подтвердить вход</span>
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>
    </div>
  );

  const renderSetupCompleteStep = () => (
    <div className="space-y-4">
      <InfoBanner tone="success">
        2FA включена. Сохраните backup-коды отдельно.
      </InfoBanner>

      <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/44">Backup-коды</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {backupCodes.map((item) => (
            <div
              key={item}
              className="rounded-[18px] border border-emerald-300/14 bg-black/16 px-3 py-3 text-center font-mono text-sm font-semibold text-emerald-50/94"
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSetupCompleteContinue}
        data-testid="setup-complete-continue"
        className={primaryButtonClassName}
      >
        Продолжить
      </button>
    </div>
  );

  const renderStepBody = () => {
    if (step === 'password') return renderNetworkAwarePasswordStep();
    if (step === 'totp_setup') return renderSetupStep();
    if (step === 'totp_verify') return renderVerifyStep();
    if (step === 'setup_complete') return renderSetupCompleteStep();
    return null;
  };

  const rememberDialogTitle = rememberDeviceMode === 'platform'
    ? 'Запомнить ПК'
    : 'Запомнить устройство';

  return (
    <div
      data-testid={isCompactViewport ? 'login-mobile-layout' : 'login-desktop-layout'}
      className="relative min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#07090c] text-white"
      style={{
        paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 12px))',
        paddingBottom: shellPaddingBottom,
        paddingLeft: 'max(16px, calc(env(safe-area-inset-left, 0px) + 12px))',
        paddingRight: 'max(16px, calc(env(safe-area-inset-right, 0px) + 12px))',
      }}
    >
      <motion.div
        aria-hidden="true"
        className="absolute left-[-18%] top-[-18%] h-[38rem] w-[38rem] rounded-full bg-cyan-700/18 blur-[130px]"
        animate={prefersReducedMotion ? undefined : { x: [0, 24, -18, 0], y: [0, 18, -12, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute bottom-[-20%] right-[-14%] h-[32rem] w-[32rem] rounded-full bg-emerald-700/12 blur-[130px]"
        animate={prefersReducedMotion ? undefined : { x: [0, -24, 18, 0], y: [0, -16, 8, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_34%),linear-gradient(180deg,rgba(18,24,31,0.42),rgba(7,9,12,0.94))]" />

      <motion.div
        {...shellMotion}
        className="relative z-10 mx-auto grid min-h-[calc(100dvh-42px)] w-full max-w-[78rem] items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(27rem,31rem)]"
        style={{ transform: isCompactViewport && contentLift ? `translateY(-${contentLift}px)` : undefined }}
      >
        {renderStatusRail()}

        <div className="mx-auto flex w-full max-w-[30rem] flex-col justify-center gap-5 md:mx-0 md:justify-self-end">
          {renderMobileHeader()}
          <motion.div
            layout
            className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.07] p-5 shadow-[0_24px_80px_rgba(2,6,23,0.48)] backdrop-blur-[26px] sm:p-6"
            style={{
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 24px 72px rgba(2,6,23,0.52)',
            }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-white/14" />
            <div className="mb-5 hidden items-start justify-between gap-4 md:flex">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">{displayStepMeta.eyebrow}</div>
                <div className="text-[1.45rem] font-semibold leading-tight tracking-[-0.04em] text-white">
                  {displayStepMeta.title}
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs font-semibold text-white/56">
                {stageLabel}
              </div>
            </div>
            <div className="space-y-4">
              {error ? <InfoBanner tone="error">{error}</InfoBanner> : null}
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={prefersReducedMotion ? undefined : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  {renderStepBody()}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          <div className="px-1 text-center text-xs leading-5 text-white/34 md:text-left">
            Безопасный доступ к HUB-IT через IIS/HTTPS, passkey, пароль и 2FA.
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {rememberDeviceOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Закрыть окно запоминания устройства"
              className="fixed inset-0 z-20 bg-black/58 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              onClick={dismissRememberDevicePrompt}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="remember-device-title"
              className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[31rem] overflow-hidden rounded-t-[28px] border border-white/10 bg-[#080b10]/94 px-5 pb-5 pt-4 text-white shadow-[0_-20px_60px_rgba(2,6,23,0.58)] backdrop-blur-[28px]"
              style={{
                paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 14px))',
                left: 'max(12px, env(safe-area-inset-left, 0px))',
                right: 'max(12px, env(safe-area-inset-right, 0px))',
              }}
              initial={prefersReducedMotion ? undefined : { opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: 24 }}
              transition={{ duration: 0.26, ease: 'easeOut' }}
            >
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/16" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <div id="remember-device-title" className="text-xl font-semibold tracking-[-0.035em] text-white">
                    {rememberDialogTitle}
                  </div>
                  <p className="text-sm leading-6 text-white/58">
                    {rememberDeviceHint || 'Следующий внешний вход можно будет подтвердить системным passkey без ручного ввода кода.'}
                  </p>
                </div>
                {rememberDeviceError ? <InfoBanner tone="error">{rememberDeviceError}</InfoBanner> : null}
                {!rememberDeviceUnsupported ? (
                  <Field
                    id="trusted-device-label"
                    label="Название устройства"
                    value={deviceLabel}
                    onChange={(event) => setDeviceLabel(event.target.value)}
                  />
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={dismissRememberDevicePrompt}
                    hidden={rememberDeviceRequired && !rememberDeviceUnsupported}
                    className={secondaryButtonClassName}
                  >
                    {rememberDeviceUnsupported ? 'Продолжить' : 'Не сейчас'}
                  </button>
                  {!rememberDeviceUnsupported ? (
                    <button
                      type="button"
                      onClick={handleRememberDevice}
                      disabled={registeringDevice}
                      className={primaryButtonClassName}
                    >
                      {registeringDevice ? <Spinner className="h-4 w-4" /> : null}
                      <span>{rememberDeviceMode === 'platform' ? 'Через Windows Hello' : 'Запомнить'}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default Login;
