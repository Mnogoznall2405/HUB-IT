import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { authAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  encodeCredential,
  getPasskeyAssertion,
  isPasskeySurfaceAvailable,
} from '../lib/passkeyWebAuthn';
import { emitAgentDebugLog } from '../lib/debugClientLog';
import {
  auditLoginPageOverlays,
  resetLoginPagePresentation,
  scheduleLoginPresentationRecovery,
} from '../lib/loginPagePresentation';
import {
  persistTotpResumeState,
  shouldOfferSafariPasswordSaveAfterLogin,
  submitSafariPasswordSaveFullPage,
  TOTP_RESUME_STORAGE_KEY,
} from '../lib/passwordCredentialSave';
import {
  alignOtpAuthAccountName,
  isAppleKeychainOtpSupported,
  toAppleOtpAuthUri,
} from '../lib/totpProvisioning';
import {
  extractWebAuthnErrorMessage,
  normalizeWebAuthnErrorName,
  registerTrustedDevice,
  resolveTrustedDeviceRegistrationMode,
} from '../lib/trustedDeviceEnrollment';
import {
  isWebAuthnApiAvailable,
  useWebAuthnAvailability,
  waitForWebAuthnApi,
} from '../lib/useWebAuthnAvailability';

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

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

function normalizeTotpInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function isCompleteBackupInput(value) {
  const trimmed = String(value || '').trim();
  if (/^[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}$/.test(trimmed)) {
    return true;
  }
  return trimmed.length >= 6;
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
  name,
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
  onFocus = null,
  solidSurface = false,
}) {
  const sharedInputClassName = cn(
    'peer w-full rounded-[18px] border px-4 pb-3 pt-6 text-[16px] text-white outline-none transition',
    solidSurface
      ? 'border-white/20 bg-[#182028] focus:border-cyan-200/35 focus:bg-[#1d2833]'
      : 'border-white/10 bg-white/[0.065] focus:border-white/25 focus:bg-white/10',
    'placeholder-transparent',
    'focus:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
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
          name={name}
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
          onFocus={onFocus}
        />
      ) : (
        <input
          id={id}
          name={name}
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
          onFocus={onFocus}
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

function InfoBanner({ tone = 'info', children, variant = 'inline' }) {
  const toneClasses = {
    info: 'border-cyan-400/18 bg-cyan-400/10 text-cyan-50/92',
    success: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-50/92',
    warning: 'border-amber-300/18 bg-amber-300/10 text-amber-50/92',
    error: 'border-rose-400/18 bg-rose-400/10 text-rose-50/92',
  };
  const toastToneClasses = {
    info: 'border-cyan-400/28 bg-[#0b1824] text-cyan-50',
    success: 'border-emerald-400/28 bg-[#0a1712] text-emerald-50',
    warning: 'border-amber-300/32 bg-[#1a1508] text-amber-50',
    error: 'border-rose-400/28 bg-[#1a0b0f] text-rose-50',
  };

  return (
    <div
      role="status"
      className={cn(
        'rounded-[18px] border px-4 py-3 text-sm leading-6',
        variant === 'toast'
          ? (toastToneClasses[tone] || toastToneClasses.info)
          : cn('backdrop-blur-sm', toneClasses[tone] || toneClasses.info),
      )}
    >
      {children}
    </div>
  );
}

function LoginTopNotice({ notice, reducedMotion = false }) {
  if (!notice?.message) {
    return null;
  }

  const shellStyle = {
    paddingTop: 'max(12px, calc(env(safe-area-inset-top, 0px) + 8px))',
  };
  const shellClassName = 'pointer-events-none fixed inset-x-0 top-0 z-50 px-4';
  const content = (
    <div
      data-testid="login-top-notice"
      className="pointer-events-auto mx-auto w-full max-w-[30rem]"
    >
      <InfoBanner tone={notice.tone} variant="toast">{notice.message}</InfoBanner>
    </div>
  );

  if (reducedMotion) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={shellClassName}
        style={shellStyle}
      >
        {content}
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        key={notice.id}
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={shellClassName}
        style={shellStyle}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

function HeroAction({
  title,
  subtitle,
  onClick,
  disabled = false,
  busy = false,
  compact = false,
  mode = 'face',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="biometric-hero-button"
      className={cn(
        'group relative w-full overflow-hidden rounded-[24px] border border-cyan-200/18 bg-cyan-200/[0.08] p-4 text-left transition',
        'hover:border-cyan-100/28 hover:bg-cyan-200/[0.12] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60',
        compact ? 'min-h-[124px]' : 'min-h-[148px]',
      )}
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 48px rgba(8,47,73,0.22)',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute right-[-40px] top-[-52px] h-36 w-36 rounded-full bg-cyan-300/18 blur-3xl opacity-55"
      />
      <div className="relative z-10 flex h-full items-center gap-4">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <div className="absolute inset-0 rounded-[22px] border border-white/12 bg-white/[0.08]" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-[19px] border border-white/14 bg-white/[0.08] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
            {busy ? (
              <Spinner className="h-7 w-7 text-cyan-100" />
            ) : mode === 'fingerprint' ? (
              <FingerprintGlyph className="h-9 w-9 text-cyan-50" />
            ) : (
              <FaceIdGlyph className="h-9 w-9 text-cyan-50" />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[1.05rem] font-semibold tracking-[-0.02em] text-white">{title}</div>
          {subtitle ? <p className="text-sm leading-5 text-white/66">{subtitle}</p> : null}
        </div>
      </div>
    </button>
  );
}

function readCompactViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 767px)').matches;
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
  const [topNotice, setTopNotice] = useState(null);
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
  const [rememberDeviceMode, setRememberDeviceMode] = useState('generic');
  const [rememberDeviceHint, setRememberDeviceHint] = useState('');
  const [rememberDeviceError, setRememberDeviceError] = useState('');
  const [showVerifyFallback, setShowVerifyFallback] = useState(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isCompactViewport, setIsCompactViewport] = useState(readCompactViewport);

  const usernameInputRef = useRef(null);
  const passkeyAttemptedRef = useRef(false);
  const authenticatedUserRef = useRef(null);
  const lastAutoSetupCodeRef = useRef('');
  const lastAutoVerifyCodeRef = useRef('');
  const noticeTimerRef = useRef(null);
  const keyboardInsetRef = useRef(0);
  const keyboardInsetRafRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const {
    webAuthnReady,
    webAuthnWebApiReady,
    webAuthnNativeReady,
    webAuthnTimedOut,
  } = useWebAuthnAvailability();

  const isPasswordSubmitDisabled = loading || !username.trim() || !password.trim();
  const isTwofaSubmitDisabled = loading || !(useBackupCode ? backupCode.trim() : totpCode.trim());
  const rememberDeviceUnsupported = rememberDeviceMode === 'unsupported';
  const canUseTrustedDeviceHero = step === 'password' && networkZone === 'external' && biometricLoginEnabled;
  const passkeyPrepPending = canUseTrustedDeviceHero && !webAuthnReady && !webAuthnTimedOut;
  const passkeyPrepFailed = canUseTrustedDeviceHero && !webAuthnReady && webAuthnTimedOut;
  const keyboardOpen = keyboardInset > 120;
  const heroCompact = keyboardOpen && step !== 'setup_complete';
  const shellPaddingBottom = keyboardOpen
    ? 'max(18px, calc(env(safe-area-inset-bottom, 0px) + 8px))'
    : 'max(24px, calc(env(safe-area-inset-bottom, 0px) + 18px))';
  const isMobileTwoFactorStep = isCompactViewport && ['totp_setup', 'totp_verify', 'setup_complete'].includes(step);
  const isMobileMinimalStep = isCompactViewport && ['password', 'totp_setup', 'totp_verify', 'setup_complete'].includes(step);

  const dismissLoginNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setTopNotice(null);
  }, []);

  const showLoginNotice = useCallback((tone, message, durationMs = 4200) => {
    const text = String(message || '').trim();
    if (!text) {
      dismissLoginNotice();
      return;
    }
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    const nextNotice = {
      tone: tone || 'info',
      message: text,
      id: Date.now(),
    };
    setTopNotice(nextNotice);
    noticeTimerRef.current = window.setTimeout(() => {
      setTopNotice((current) => (current?.id === nextNotice.id ? null : current));
      noticeTimerRef.current = null;
    }, Math.max(1800, Number(durationMs) || 4200));
  }, [dismissLoginNotice]);

  const reportLoginError = useCallback((message) => {
    showLoginNotice('error', message, 5200);
  }, [showLoginNotice]);

  const handleCompactFieldFocus = useCallback((event) => {
    if (!isCompactViewport) {
      return;
    }
    const target = event?.currentTarget || event?.target;
    window.requestAnimationFrame(() => {
      target?.scrollIntoView?.({
        block: 'center',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    });
  }, [isCompactViewport, prefersReducedMotion]);

  const stepMeta = {
    password: {
      eyebrow: 'Вход',
      title: 'Рабочая среда HUB-IT',
      description: 'Войдите по passkey или используйте логин и пароль.',
    },
    totp_setup: {
      eyebrow: 'Добавить 2FA',
      title: 'Добавьте 2FA',
      description: 'Откройте приложение кодов и введите 6 цифр.',
    },
    totp_verify: {
      eyebrow: '2FA',
      title: 'Код 2FA',
      description: '6 цифр из приложения или backup-код.',
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

    const loginAccountName = username.trim() || String(setupData?.account_name || '').trim();
    let qrUri = alignOtpAuthAccountName(otpauthUri, loginAccountName);

    QRCode.toDataURL(qrUri, {
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
  }, [setupData?.otpauth_uri, setupData?.account_name, username]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const params = new URLSearchParams(window.location.search);
    const resumeChallenge = String(params.get('resume_challenge') || '').trim();
    if (!resumeChallenge) {
      return undefined;
    }

    let cancelled = false;
    let resumePayload = null;
    try {
      const raw = sessionStorage.getItem(TOTP_RESUME_STORAGE_KEY);
      resumePayload = raw ? JSON.parse(raw) : null;
    } catch {
      resumePayload = null;
    }
    sessionStorage.removeItem(TOTP_RESUME_STORAGE_KEY);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('resume_challenge');
    window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);

    const resumeNextStep = String(resumePayload?.nextStep || 'totp_setup').trim();

    (async () => {
      dismissLoginNotice();
      setLoginChallengeId(resumeChallenge);
      if (resumePayload?.username) {
        setUsername(String(resumePayload.username || '').trim());
      }
      setLoading(true);

      if (resumeNextStep === 'totp_verify') {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setStep('totp_verify');
        // #region agent log
        emitAgentDebugLog({
          location: 'Login.jsx:resumeTotpSetup',
          message: 'totp verify resumed after password save page',
          hypothesisId: 'H11',
          data: {
            resumeChallenge,
            nextStep: resumeNextStep,
            loginUsername: String(resumePayload?.username || ''),
          },
        });
        // #endregion
        return;
      }

      const setupResult = await startTwoFactorSetup(resumeChallenge);
      if (cancelled) {
        return;
      }
      setLoading(false);
      // #region agent log
      emitAgentDebugLog({
        location: 'Login.jsx:resumeTotpSetup',
        message: 'totp setup resumed after password save page',
        hypothesisId: 'H11',
        data: {
          resumeChallenge,
          nextStep: resumeNextStep,
          setupSuccess: Boolean(setupResult?.success),
          loginUsername: String(resumePayload?.username || ''),
        },
      });
      // #endregion
      if (!setupResult.success) {
        reportLoginError(setupResult.error);
        setStep('password');
        return;
      }
      setSetupData(setupResult);
      setStep('totp_setup');
    })();

    return () => {
      cancelled = true;
    };
  }, [dismissLoginNotice, reportLoginError, startTwoFactorSetup]);

  useEffect(() => () => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    if (keyboardInsetRafRef.current) {
      window.cancelAnimationFrame(keyboardInsetRafRef.current);
    }
  }, []);

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
      } catch {
        if (cancelled) {
          return;
        }
        setNetworkZone('external');
        setBiometricLoginEnabled(false);
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
    if (typeof window === 'undefined' || !window.visualViewport) {
      return undefined;
    }

    const updateViewportInset = () => {
      if (keyboardInsetRafRef.current) {
        return;
      }
      keyboardInsetRafRef.current = window.requestAnimationFrame(() => {
        keyboardInsetRafRef.current = null;
        const viewport = window.visualViewport;
        if (!viewport) {
          return;
        }
        const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        if (Math.abs(inset - keyboardInsetRef.current) < 12) {
          return;
        }
        keyboardInsetRef.current = inset;
        setKeyboardInset(inset);
      });
    };

    updateViewportInset();
    window.visualViewport.addEventListener('resize', updateViewportInset);
    window.visualViewport.addEventListener('scroll', updateViewportInset);
    return () => {
      window.visualViewport.removeEventListener('resize', updateViewportInset);
      window.visualViewport.removeEventListener('scroll', updateViewportInset);
      if (keyboardInsetRafRef.current) {
        window.cancelAnimationFrame(keyboardInsetRafRef.current);
        keyboardInsetRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setShowVerifyFallback(true);
  }, [step]);

  useEffect(() => {
    if (loginModeLoading || step !== 'password' || !usernameInputRef.current) {
      return;
    }
    usernameInputRef.current.focus();
  }, [loginModeLoading, step]);

  const clearPasskeyPresentationLock = useCallback(() => {
    setRememberDeviceOpen(false);
    resetLoginPagePresentation({
      logContext: 'clearPasskeyPresentationLock',
      hypothesisId: 'H4',
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (rememberDeviceOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    resetLoginPagePresentation({
      logContext: 'rememberDeviceClosed',
      hypothesisId: 'H1',
    });
    return undefined;
  }, [rememberDeviceOpen]);

  useEffect(() => {
    if (
      loginModeLoading
      || step !== 'password'
      || networkZone !== 'external'
      || !biometricLoginEnabled
      || !webAuthnReady
      || passkeyAttemptedRef.current
    ) {
      return;
    }
    passkeyAttemptedRef.current = true;
    void attemptPasskeyLogin({ auto: true });
  }, [loginModeLoading, step, networkZone, biometricLoginEnabled, webAuthnReady]);

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

  const applyRememberDeviceRegistrationMode = async ({ required = false } = {}) => {
    const registrationMode = await resolveTrustedDeviceRegistrationMode();
    if (registrationMode.mode === 'unsupported') {
      if (!required) {
        redirectToDashboard();
        return false;
      }
      setRememberDeviceMode('unsupported');
      setRememberDeviceHint(registrationMode.hint);
      setRememberDeviceOpen(true);
      return true;
    }
    setRememberDeviceMode(registrationMode.mode);
    setRememberDeviceHint(registrationMode.hint);
    setRememberDeviceOpen(true);
    return true;
  };

  const maybeOpenRememberDevicePrompt = async (enabled) => {
    setRememberDeviceError('');
    setRememberDeviceRequired(false);
    if (!enabled) {
      redirectToDashboard();
      return;
    }
    const opened = await applyRememberDeviceRegistrationMode({ required: false });
    if (opened) {
      setRememberDeviceHint(
        'У вас уже есть passkey на другом устройстве. Привяжите это устройство, чтобы входить здесь без TOTP.',
      );
    }
  };

  const openRememberDevicePrompt = async ({ enabled, required = false } = {}) => {
    setRememberDeviceError('');
    setRememberDeviceRequired(Boolean(required));
    if (!enabled) {
      redirectToDashboard();
      return;
    }
    const opened = await applyRememberDeviceRegistrationMode({ required: Boolean(required) });
    if (!opened && !required) {
      redirectToDashboard();
    }
  };

  const revealPasswordFallback = (message = '') => {
    const text = String(message || '').trim();
    if (text) {
      // #region agent log
      emitAgentDebugLog({
        location: 'Login.jsx:revealPasswordFallback',
        message: 'passkey fallback notice requested',
        hypothesisId: 'H2',
        data: {
          noticeLength: text.length,
          rememberDeviceOpen,
          canUseTrustedDeviceHero,
        },
      });
      // #endregion
      showLoginNotice('warning', text, 5600);
    }
    if (typeof window === 'undefined' || !isCompactViewport) {
      return;
    }
    window.requestAnimationFrame(() => {
      const usernameField = document.getElementById('login-username');
      usernameField?.scrollIntoView?.({
        block: 'center',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    });
  };

  useEffect(() => {
    if (!passkeyPrepFailed) {
      return;
    }
    showLoginNotice('warning', 'Passkey в приложении не инициализировался. Войдите по логину и паролю ниже.', 5600);
  }, [passkeyPrepFailed, showLoginNotice]);

  useEffect(() => {
    if (!topNotice?.message) {
      return;
    }
    // #region agent log
    emitAgentDebugLog({
      location: 'Login.jsx:noticeOverlayState',
      message: 'login notice visible overlay snapshot',
      hypothesisId: 'H1',
      data: {
        topNoticeTone: topNotice.tone,
        rememberDeviceOpen,
        passwordFormVisible: step === 'password' && !loginModeLoading,
        passkeyPrepFailed,
        step,
      },
    });
    // #endregion
  }, [topNotice, rememberDeviceOpen, loginModeLoading, passkeyPrepFailed, step]);

  useEffect(() => {
    if (typeof window === 'undefined' || step !== 'password' || loginModeLoading) {
      return;
    }
    const form = document.querySelector('[data-testid="password-auth-form"]');
    const usernameField = document.getElementById('login-username');
    const root = document.querySelector('[data-testid="login-mobile-layout"]');
    const formRect = form?.getBoundingClientRect?.();
    const usernameRect = usernameField?.getBoundingClientRect?.();
    const viewportHeight = window.innerHeight;
    const formFullyVisible = Boolean(
      formRect
      && formRect.top >= 0
      && formRect.bottom <= viewportHeight + 2,
    );
    const usernameFullyVisible = Boolean(
      usernameRect
      && usernameRect.top >= 0
      && usernameRect.bottom <= viewportHeight + 2,
    );
    const loginCard = document.querySelector('[data-testid="login-form-card"]');
    const usernameStyle = usernameField ? window.getComputedStyle(usernameField) : null;
    const cardStyle = loginCard ? window.getComputedStyle(loginCard) : null;
    // #region agent log
    emitAgentDebugLog({
      location: 'Login.jsx:passwordFormLayout',
      message: 'password form layout snapshot',
      hypothesisId: 'H3',
      data: {
        step,
        loginModeLoading,
        trustedDeviceBusy,
        rememberDeviceOpen,
        hasTopNotice: Boolean(topNotice?.message),
        isCompactViewport,
        formInDom: Boolean(form),
        usernameInDom: Boolean(usernameField),
        formFullyVisible,
        usernameFullyVisible,
        formTop: formRect ? Math.round(formRect.top) : null,
        formBottom: formRect ? Math.round(formRect.bottom) : null,
        usernameTop: usernameRect ? Math.round(usernameRect.top) : null,
        viewportHeight,
        rootOverflowY: root ? window.getComputedStyle(root).overflowY : null,
        scrollHeight: document.documentElement.scrollHeight,
        overlayCount: auditLoginPageOverlays().overlays?.length || 0,
        usernameOpacity: usernameStyle?.opacity || null,
        usernameBackdropFilter: usernameStyle?.backdropFilter || usernameStyle?.webkitBackdropFilter || null,
        cardOpacity: cardStyle?.opacity || null,
        cardBackdropFilter: cardStyle?.backdropFilter || cardStyle?.webkitBackdropFilter || null,
        cardBackgroundColor: cardStyle?.backgroundColor || null,
      },
    });
    // #endregion
  }, [
    step,
    loginModeLoading,
    trustedDeviceBusy,
    rememberDeviceOpen,
    topNotice,
    isCompactViewport,
    keyboardInset,
  ]);

  const attemptPasskeyLogin = async ({ auto = false } = {}) => {
    if (step !== 'password') {
      return false;
    }
    dismissLoginNotice();
    const webAuthnAvailable = webAuthnReady || await waitForWebAuthnApi({
      delayMs: webAuthnReady ? 0 : 300,
      maxWaitMs: webAuthnReady ? 500 : 3000,
    }) || await isPasskeySurfaceAvailable();
    if (!webAuthnAvailable) {
      revealPasswordFallback(
        auto
          ? ''
          : (webAuthnTimedOut
            ? 'На этом устройстве системный passkey недоступен. Продолжите вход по логину и паролю.'
            : 'Passkey ещё инициализируется. Подождите секунду и нажмите «Войти через passkey» снова.'),
      );
      return false;
    }
    setTrustedDeviceBusy(true);
    let presentationRecoveryCleanup = null;
    try {
      const optionsResult = await startPasskeyLogin();
      if (!optionsResult.success) {
        revealPasswordFallback(
          auto
            ? 'Автоматический вход по passkey не сработал. Продолжите вход по логину и паролю.'
            : (optionsResult.error || 'Не удалось начать вход по биометрии. Продолжите по логину и паролю.'),
        );
        return false;
      }

      const credential = await getPasskeyAssertion(optionsResult.public_key);
      const verifyResult = await verifyPasskeyLogin(
        optionsResult.challenge_id,
        encodeCredential(credential),
      );
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
      clearPasskeyPresentationLock();
      const friendlyMessage = extractWebAuthnErrorMessage(passkeyError, 'Не удалось подтвердить вход по биометрии');
      const overlayAudit = auditLoginPageOverlays();
      // #region agent log
      emitAgentDebugLog({
        location: 'Login.jsx:attemptPasskeyLogin:catch',
        message: 'passkey canceled or failed',
        hypothesisId: 'H1',
        data: {
          errorName: normalizeWebAuthnErrorName(passkeyError),
          rememberDeviceOpenAfterClear: false,
          overlayCount: overlayAudit.overlays?.length || 0,
          overlays: overlayAudit.overlays?.slice(0, 6) || [],
          userAgent: overlayAudit.userAgent,
        },
      });
      // #endregion
      presentationRecoveryCleanup = scheduleLoginPresentationRecovery({
        focusUsername: isCompactViewport,
        logContext: 'attemptPasskeyLogin:catch',
      });
      revealPasswordFallback(
        auto
          ? 'Если passkey на этом устройстве недоступен или не был подтверждён, продолжите вход по логину и паролю.'
          : friendlyMessage,
      );
      return false;
    } finally {
      setTrustedDeviceBusy(false);
      if (!presentationRecoveryCleanup) {
        presentationRecoveryCleanup = scheduleLoginPresentationRecovery({
          focusUsername: isCompactViewport,
          logContext: 'attemptPasskeyLogin:finally',
        });
      }
    }
  };

  const shouldRequireTrustedDeviceEnrollment = (userPayload) => (
    networkZone === 'external'
    && Number(userPayload?.discoverable_trusted_devices_count || 0) <= 0
  );

  const shouldOfferOptionalTrustedDeviceEnrollment = (userPayload) => (
    networkZone === 'external'
    && Number(userPayload?.discoverable_trusted_devices_count || 0) > 0
  );

  const completeAuthenticatedRedirect = async (userPayload) => {
    authenticatedUserRef.current = userPayload || null;
    if (shouldRequireTrustedDeviceEnrollment(userPayload)) {
      await openRememberDevicePrompt({ enabled: true, required: true });
      return;
    }
    if (shouldOfferOptionalTrustedDeviceEnrollment(userPayload)) {
      await maybeOpenRememberDevicePrompt(true);
      return;
    }
    redirectToDashboard();
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    dismissLoginNotice();
    setLoading(true);
    const result = await login(username.trim(), password);
    setLoading(false);

    if (!result.success) {
      reportLoginError(result.error);
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

    const offerSafariPasswordSave = shouldOfferSafariPasswordSaveAfterLogin();
    const redirectSafariPasswordSave = (nextStep) => {
      persistTotpResumeState({
        loginChallengeId: result.login_challenge_id,
        username: username.trim(),
        nextStep,
      });
      submitSafariPasswordSaveFullPage({
        username: username.trim(),
        password,
        loginChallengeId: result.login_challenge_id,
      });
    };

    if (result.status === '2fa_setup_required') {
      if (offerSafariPasswordSave) {
        redirectSafariPasswordSave('totp_setup');
        return;
      }
      setLoading(true);
      const setupResult = await startTwoFactorSetup(result.login_challenge_id);
      setLoading(false);
      if (!setupResult.success) {
        reportLoginError(setupResult.error);
        return;
      }
      setSetupData(setupResult);
      setStep('totp_setup');
      return;
    }

    if (offerSafariPasswordSave) {
      redirectSafariPasswordSave('totp_verify');
      return;
    }

    setStep('totp_verify');
  };

  const submitTwoFactorSetup = async ({ autoContinue = false } = {}) => {
    dismissLoginNotice();
    setLoading(true);
    const result = await verifyTwoFactorSetup(loginChallengeId, totpCode.trim());
    setLoading(false);
    if (!result.success) {
      reportLoginError(result.error);
      return;
    }
    authenticatedUserRef.current = result.user || null;
    setBackupCodes(Array.isArray(result.backup_codes) ? result.backup_codes : []);
    if (autoContinue) {
      await completeAuthenticatedRedirect(result.user || null);
      return;
    }
    setStep('setup_complete');
  };

  const handleVerifySetup = async (event) => {
    event?.preventDefault();
    await submitTwoFactorSetup();
  };

  const submitTwoFactorLogin = async () => {
    dismissLoginNotice();
    setLoading(true);
    const result = await verifyTwoFactorLogin(
      loginChallengeId,
      useBackupCode
        ? { backup_code: backupCode.trim() }
        : { totp_code: totpCode.trim() },
    );
    setLoading(false);
    if (!result.success) {
      reportLoginError(result.error);
      return;
    }
    await completeAuthenticatedRedirect(result.user || null);
  };

  const handleVerifyLogin = async (event) => {
    event?.preventDefault();
    await submitTwoFactorLogin();
  };

  useEffect(() => {
    lastAutoSetupCodeRef.current = '';
    lastAutoVerifyCodeRef.current = '';
  }, [step, useBackupCode]);

  useEffect(() => {
    const code = normalizeTotpInput(totpCode);
    if (isCompactViewport && step === 'totp_setup' && code.length < 6) {
      lastAutoSetupCodeRef.current = '';
    }
    if (
      !isCompactViewport
      || step !== 'totp_setup'
      || loading
      || !loginChallengeId
      || code.length !== 6
      || code !== totpCode
      || lastAutoSetupCodeRef.current === code
    ) {
      return undefined;
    }

    lastAutoSetupCodeRef.current = code;
    const timeout = window.setTimeout(() => {
      void submitTwoFactorSetup({ autoContinue: true });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [isCompactViewport, loginChallengeId, loading, step, totpCode]);

  useEffect(() => {
    if (!isCompactViewport || step !== 'totp_verify' || loading || !loginChallengeId) {
      return undefined;
    }

    const rawCode = useBackupCode ? backupCode.trim() : normalizeTotpInput(totpCode);
    const complete = useBackupCode
      ? isCompleteBackupInput(rawCode)
      : rawCode.length === 6 && rawCode === totpCode;

    if (!complete) {
      lastAutoVerifyCodeRef.current = '';
    }

    if (!complete || lastAutoVerifyCodeRef.current === `${useBackupCode ? 'backup' : 'totp'}:${rawCode}`) {
      return undefined;
    }

    const key = `${useBackupCode ? 'backup' : 'totp'}:${rawCode}`;
    lastAutoVerifyCodeRef.current = key;
    const timeout = window.setTimeout(() => {
      void submitTwoFactorLogin();
    }, useBackupCode ? 650 : 180);
    return () => window.clearTimeout(timeout);
  }, [backupCode, isCompactViewport, loading, loginChallengeId, step, totpCode, useBackupCode]);

  const copyTotpSetupValue = async (kind, value) => {
    const text = String(value || '').trim();
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showLoginNotice('success', 'Ключ скопирован', 2400);
    } catch {
      reportLoginError('Не удалось скопировать ключ');
    }
  };

  const handleTrustedDeviceAuth = async () => {
    dismissLoginNotice();
    setTrustedDeviceBusy(true);
    const optionsResult = await refreshTrustedDeviceAuth(loginChallengeId);
    if (!optionsResult.success) {
      setTrustedDeviceBusy(false);
      reportLoginError(optionsResult.error);
      return;
    }

    try {
      const credential = await getPasskeyAssertion(optionsResult.public_key);
      const verifyResult = await verifyTrustedDeviceAuth(
        loginChallengeId,
        optionsResult.challenge_id,
        encodeCredential(credential),
      );
      setTrustedDeviceBusy(false);
      if (!verifyResult.success) {
        reportLoginError(verifyResult.error);
        return;
      }
      redirectToDashboard();
    } catch (authError) {
      setTrustedDeviceBusy(false);
      reportLoginError(extractWebAuthnErrorMessage(authError, 'Не удалось подтвердить доверенное устройство'));
    }
  };

  const handleRememberDevice = async () => {
    setRegisteringDevice(true);
    dismissLoginNotice();
    setRememberDeviceError('');
    try {
      await registerTrustedDevice({
        authAPI,
        label: deviceLabel,
        platformOnly: rememberDeviceMode === 'platform',
      });
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

  const shellMotion = prefersReducedMotion || isCompactViewport
    ? {}
    : {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.28, ease: 'easeOut' },
    };

  const primaryButtonClassName = 'flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] !bg-cyan-200 px-5 text-[15px] font-semibold !text-zinc-950 transition hover:!bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-55';
  const secondaryButtonClassName = 'flex min-h-12 w-full items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.045] px-5 text-sm font-semibold text-white/78 transition hover:bg-white/[0.08]';

  const renderStatusRail = () => (
    <aside className="hidden min-h-[620px] flex-col rounded-[32px] border border-white/10 bg-white/[0.045] p-8 shadow-[0_28px_90px_rgba(2,6,23,0.38)] backdrop-blur-2xl md:flex">
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

        {!loginModeLoading && networkZone === 'external' ? (
          <div className="rounded-[24px] border border-cyan-200/14 bg-cyan-200/[0.06] p-5">
            <div className="text-sm font-semibold text-cyan-50">Внешний вход</div>
            <p className="mt-2 text-sm leading-6 text-white/56">
              Снаружи система сначала пробует доверенное устройство. Если его нет, вход завершится паролем и кодом.
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );

  const renderMobileHeader = () => (
    <div className={cn('px-1 md:hidden', isMobileMinimalStep ? 'space-y-2' : 'space-y-3')}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold tracking-[0.08em] text-white/72">HUB-IT</div>
        <div className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-xs font-semibold text-white/58">
          {networkLabel}
        </div>
      </div>
      <div className={cn(isMobileMinimalStep ? 'space-y-1' : 'space-y-2')}>
        <div className={cn(
          'font-semibold leading-[1.05] tracking-[-0.045em] text-white',
          isMobileMinimalStep ? 'text-[1.45rem]' : 'text-[1.75rem]',
        )}>
          {isCompactViewport && step === 'password' ? 'Вход в HUB-IT' : displayStepMeta.title}
        </div>
        {!isMobileMinimalStep ? (
          <p className="text-sm leading-6 text-white/56">
            {displayStepMeta.description}
          </p>
        ) : null}
      </div>
    </div>
  );

  const renderNetworkAwarePasswordStep = () => {
    if (loginModeLoading) {
      return (
        <div
          data-testid="login-mode-loading"
          className={cn(
            'flex flex-col items-center justify-center gap-4 rounded-[24px] border border-white/10 bg-[#111820] text-center',
            isCompactViewport ? 'min-h-[150px] p-5' : 'min-h-[220px] bg-white/[0.04] p-6 backdrop-blur-xl',
          )}
        >
          <Spinner className="h-8 w-8 text-sky-100" />
          <div className="space-y-2">
            <div className="text-base font-semibold text-white">Определяем режим входа</div>
            {!isCompactViewport ? (
              <p className="text-sm leading-6 text-white/58">
                Проверяем сеть и доступность passkey.
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className={cn(isCompactViewport ? 'space-y-3' : 'space-y-4')}>
        {canUseTrustedDeviceHero ? (
          <HeroAction
            title={
              trustedDeviceBusy
                ? 'Подтверждаем passkey'
                : (webAuthnReady
                  ? 'Войти через passkey'
                  : (passkeyPrepFailed ? 'Passkey не готов' : 'Подготовка passkey'))
            }
            subtitle={
              isCompactViewport && webAuthnReady
                ? 'Быстрый вход без кода.'
                : webAuthnReady
                ? 'Быстрый вход с доверенного телефона или ПК.'
                : (passkeyPrepFailed
                  ? (webAuthnNativeReady
                    ? 'Вход через системный passkey (Credential Manager).'
                    : 'Обновите Android System WebView или войдите по паролю ниже.')
                  : 'Инициализация входа по отпечатку в приложении…')
            }
            onClick={() => attemptPasskeyLogin({ auto: false })}
            disabled={trustedDeviceBusy || loading || passkeyPrepPending}
            busy={trustedDeviceBusy || passkeyPrepPending}
            compact={isCompactViewport || heroCompact}
            mode={isCompactViewport ? 'fingerprint' : 'face'}
          />
        ) : !isCompactViewport ? (
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
        ) : null}

        <form
          onSubmit={handlePasswordSubmit}
          autoComplete="on"
          data-testid="password-auth-form"
          className={cn(isCompactViewport ? 'space-y-3' : 'space-y-4')}
        >
              <Field
                id="login-username"
                name="username"
                label="Логин"
                inputRef={usernameInputRef}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={loading}
                onFocus={handleCompactFieldFocus}
                solidSurface={isCompactViewport}
              />
              <Field
                id="login-password"
                name="password"
                label="Пароль"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={loading}
                onFocus={handleCompactFieldFocus}
                solidSurface={isCompactViewport}
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
            </form>
      </div>
    );
  };

  const renderSetupStep = () => {
    const totpSetupUri = String(setupData?.otpauth_uri || '').trim();
    const totpManualKey = String(setupData?.manual_entry_key || '').trim();
    const appleOtpSupported = isAppleKeychainOtpSupported();
    const loginAccountName = username.trim() || String(setupData?.account_name || '').trim();
    const alignedTotpSetupUri = alignOtpAuthAccountName(totpSetupUri, loginAccountName);

    const totpActionButtonClassName = cn(
      'flex w-full items-center justify-center !bg-cyan-200 px-5 text-center font-semibold !text-zinc-950 !no-underline transition hover:!bg-cyan-100 hover:!no-underline',
      isCompactViewport ? 'min-h-12 rounded-[16px] text-sm' : 'min-h-14 rounded-[18px] text-[15px]',
    );

    const openAuthenticatorAction = alignedTotpSetupUri ? (
      appleOtpSupported ? (
        <button
          type="button"
          data-testid="totp-open-apple-passwords"
          className={totpActionButtonClassName}
          onClick={() => {
            const appleHref = toAppleOtpAuthUri(alignedTotpSetupUri);
            // #region agent log
            emitAgentDebugLog({
              location: 'Login.jsx:totp-open-apple-passwords',
              message: 'apple-otpauth navigation',
              hypothesisId: 'H5',
              data: {
                loginUsername: loginAccountName,
                issuer: String(setupData?.issuer || ''),
                hrefAccount: alignedTotpSetupUri.split('?')[0]?.split(':').slice(-1)[0] || '',
              },
            });
            // #endregion
            window.location.assign(appleHref);
          }}
        >
          Добавить в Пароли
        </button>
      ) : (
        <a
          href={alignedTotpSetupUri}
          data-testid="totp-open-authenticator"
          className={totpActionButtonClassName}
        >
          Открыть в приложении кодов
        </a>
      )
    ) : null;

    const alternateSetupPanel = (
      <details
        className={cn(
          'border border-white/10 bg-white/[0.035] backdrop-blur-xl',
          isCompactViewport ? 'rounded-[18px] p-3' : 'rounded-[20px] p-4',
        )}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white/72 [&::-webkit-details-marker]:hidden">
          <span>QR-код и ручной ключ</span>
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">Показать</span>
        </summary>
        <div className="mt-3 space-y-3">
          {totpQrDataUrl ? (
            <div className="flex justify-center rounded-[14px] border border-white/8 bg-white/[0.04] p-2.5">
              <img
                src={totpQrDataUrl}
                alt="TOTP QR"
                data-testid="totp-qr-image"
                className="h-auto w-full max-w-[148px] rounded-[12px] bg-white p-2"
              />
            </div>
          ) : (
            <InfoBanner tone="warning">QR-код недоступен — используйте ручной ключ ниже.</InfoBanner>
          )}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/44">Ключ</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1 break-all rounded-[14px] bg-black/20 px-3 py-2.5 font-mono text-sm text-white/88">
                {totpManualKey || '—'}
              </div>
              <button
                type="button"
                data-testid="totp-copy-manual-key"
                disabled={!totpManualKey}
                onClick={() => {
                  void copyTotpSetupValue('manual', totpManualKey);
                }}
                className="min-h-11 rounded-[14px] border border-white/10 px-3 text-sm font-semibold text-white/76 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Скопировать
              </button>
            </div>
          </div>
        </div>
      </details>
    );

    const setupHint = appleOtpSupported
      ? 'Нажмите «Добавить в Пароли» и выберите сохранённую запись hubit.zsgp.ru.'
      : 'Откройте приложение кодов и добавьте HUB-IT.';

    const setupBody = (
      <>
        <p className="text-sm leading-6 text-white/62">{setupHint}</p>
        {openAuthenticatorAction}
        <Field
          id="login-totp-setup-code"
          label={isCompactViewport ? '6-значный код' : 'Код из приложения'}
          value={totpCode}
          onChange={(event) => setTotpCode(normalizeTotpInput(event.target.value))}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={loading}
          onFocus={handleCompactFieldFocus}
          endAdornment={loading ? <Spinner className="h-5 w-5 text-cyan-100" /> : null}
        />
        {alternateSetupPanel}
        {!isCompactViewport ? (
          <button
            type="submit"
            disabled={isTwofaSubmitDisabled}
            className={primaryButtonClassName}
          >
            {loading ? <Spinner className="h-5 w-5" /> : null}
            <span>Подтвердить код</span>
          </button>
        ) : null}
      </>
    );

    return (
      <form onSubmit={handleVerifySetup} className={cn(isCompactViewport ? 'space-y-3' : 'space-y-4')}>
        {setupBody}
      </form>
    );
  };

  const renderVerifyStep = () => (
    <div className={cn(isCompactViewport ? 'space-y-3' : 'space-y-4')}>
      {canUseTrustedDeviceHero ? (
        <HeroAction
          title={trustedDeviceBusy ? 'Подтверждаем passkey' : 'Доверенное устройство'}
          subtitle={isCompactViewport ? 'Passkey без кода.' : 'Подтвердите вход системным passkey.'}
          onClick={handleTrustedDeviceAuth}
          disabled={trustedDeviceBusy || loading}
          busy={trustedDeviceBusy}
          compact={heroCompact}
          mode={isCompactViewport ? 'fingerprint' : 'face'}
        />
      ) : !isCompactViewport ? (
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
      ) : null}

      <div className={cn(
        'flex flex-wrap items-center gap-3',
        isCompactViewport ? 'justify-end' : 'justify-between',
      )}>
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

      {(showVerifyFallback || !canUseTrustedDeviceHero) ? (
        <form
          onSubmit={handleVerifyLogin}
          data-testid="verify-fallback-form"
          className={cn(isCompactViewport ? 'space-y-3' : 'space-y-4')}
        >
          <Field
            id="login-totp-verify"
            label={useBackupCode ? 'Backup-код' : (isCompactViewport ? '6-значный код' : 'Код из приложения')}
            value={useBackupCode ? backupCode : totpCode}
            onChange={(event) => {
              if (useBackupCode) {
                setBackupCode(event.target.value);
              } else {
                setTotpCode(normalizeTotpInput(event.target.value));
              }
            }}
            inputMode={useBackupCode ? 'text' : 'numeric'}
            autoComplete={useBackupCode ? undefined : 'one-time-code'}
            disabled={loading}
            onFocus={handleCompactFieldFocus}
            endAdornment={isCompactViewport && loading ? <Spinner className="h-5 w-5 text-cyan-100" /> : null}
          />
          {!isCompactViewport ? (
            <button
              type="submit"
              disabled={isTwofaSubmitDisabled}
              className={primaryButtonClassName}
            >
              {loading ? <Spinner className="h-5 w-5" /> : null}
              <span>Подтвердить вход</span>
            </button>
          ) : null}
        </form>
      ) : null}
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
  const mobileNoticeInset = topNotice?.message && isCompactViewport
    ? 'max(88px, calc(env(safe-area-inset-top, 0px) + 72px))'
    : undefined;

  return (
    <div
      data-testid={isCompactViewport ? 'login-mobile-layout' : 'login-desktop-layout'}
      className={cn(
        'relative min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#07090c] text-white',
        isCompactViewport ? 'login-mobile-shell overflow-y-auto' : (keyboardOpen ? 'overflow-y-auto' : 'overflow-y-hidden'),
      )}
      style={{
        paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 12px))',
        paddingBottom: shellPaddingBottom,
        paddingLeft: 'max(16px, calc(env(safe-area-inset-left, 0px) + 12px))',
        paddingRight: 'max(16px, calc(env(safe-area-inset-right, 0px) + 12px))',
        scrollPaddingBottom: keyboardOpen ? '24px' : undefined,
      }}
    >
      {!isCompactViewport && !prefersReducedMotion ? (
        <>
          <div aria-hidden="true" className="login-ambient-blob login-ambient-blob--primary" />
          <div aria-hidden="true" className="login-ambient-blob login-ambient-blob--secondary" />
        </>
      ) : !isCompactViewport ? (
        <>
          <div aria-hidden="true" className="login-ambient-blob login-ambient-blob--primary !animate-none" />
          <div aria-hidden="true" className="login-ambient-blob login-ambient-blob--secondary !animate-none" />
        </>
      ) : null}
      {!isCompactViewport ? (
        <div
          aria-hidden="true"
          data-login-decorative="true"
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_34%),linear-gradient(180deg,rgba(18,24,31,0.42),rgba(7,9,12,0.94))]"
        />
      ) : null}

      <LoginTopNotice
        notice={topNotice}
        reducedMotion={prefersReducedMotion}
      />

      <motion.div
        {...shellMotion}
        className={cn(
          'relative z-10 mx-auto grid w-full max-w-[78rem] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(27rem,31rem)]',
          isCompactViewport ? 'items-start py-2' : 'min-h-[calc(100dvh-42px)] items-center',
        )}
        style={mobileNoticeInset ? { paddingTop: mobileNoticeInset } : undefined}
      >
        {renderStatusRail()}

        <div className="mx-auto flex w-full max-w-[30rem] flex-col justify-center gap-5 md:mx-0 md:justify-self-end">
          {renderMobileHeader()}
          <div
            data-testid="login-form-card"
            className={cn(
              'relative overflow-hidden border shadow-[0_24px_80px_rgba(2,6,23,0.48)]',
              isMobileMinimalStep
                ? 'login-mobile-card rounded-[24px] border border-white/10 bg-[#111820] p-4 shadow-none'
                : 'rounded-[28px] border-white/10 bg-white/[0.07] p-5 backdrop-blur-xl sm:p-6',
            )}
            style={isMobileMinimalStep ? undefined : {
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
              {prefersReducedMotion || isCompactViewport ? (
                <div key={step}>
                  {renderStepBody()}
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                  >
                    {renderStepBody()}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>

          {!isMobileMinimalStep ? (
            <div className="px-1 text-center text-xs leading-5 text-white/34 md:text-left">
              Безопасный доступ к HUB-IT через IIS/HTTPS, passkey, пароль и 2FA.
            </div>
          ) : null}
        </div>
      </motion.div>

      <AnimatePresence>
        {rememberDeviceOpen ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remember-device-title"
            data-testid="login-remember-device-dialog"
            className="fixed bottom-0 z-30 w-[calc(100vw-24px)] max-w-[31rem] overflow-hidden rounded-t-[28px] border border-white/10 bg-[#080b10] px-5 pb-5 pt-4 text-white shadow-[0_-20px_60px_rgba(2,6,23,0.58)] md:bottom-6 md:rounded-[28px]"
              style={{
                paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 14px))',
                right: 'max(12px, env(safe-area-inset-right, 0px))',
              }}
              initial={prefersReducedMotion ? undefined : { opacity: 0, y: 40, x: 14 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: 24, x: 10 }}
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
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default Login;
