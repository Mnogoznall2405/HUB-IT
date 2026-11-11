export const MOBILE_APP_PRINT_MESSAGE_TYPE = 'hubit.portal.print';
export const MOBILE_APP_COMMAND_MESSAGE_TYPE = 'hubit.portal.native-command';
export const MOBILE_APP_COMMAND_RESPONSE_EVENT = 'hubit:mobile-native-command-response';
export const MOBILE_APP_COMMAND_SCHEMA_VERSION = 1;
export const MOBILE_APP_COMMAND_TIMEOUT_MS = 15_000;

const MOBILE_APP_COMMANDS = new Set([
  'notifications.getState',
  'notifications.requestPermission',
  'notifications.openSettings',
  'notifications.openChannelSettings',
  'update.getState',
  'update.check',
  'update.install',
  'update.openInstallerSettings',
  'appLock.getState',
  'appLock.update',
  'biometrics.enable',
  'biometrics.disable',
  'diagnostics.getState',
  'diagnostics.share',
  'diagnostics.clear',
  'offline.getState',
  'offline.retryQueues',
  'offline.clearFileCache',
  'network.getState',
  'system.openBackgroundSettings',
  'haptics.perform',
  'share.text',
]);

let commandSequence = 0;

const getMobileAppTransport = (runtimeWindow = typeof window === 'undefined' ? undefined : window) => {
  if (!runtimeWindow?.__HUBIT_MOBILE_APP__) return null;
  const transport = runtimeWindow?.ReactNativeWebView;
  return transport && typeof transport.postMessage === 'function' ? transport : null;
};

export const isMobileAppWebViewRuntime = (
  runtimeWindow = typeof window === 'undefined' ? undefined : window,
) => Boolean(getMobileAppTransport(runtimeWindow));

export const requestMobileAppPrint = ({ html, title = 'Письмо' } = {}, runtimeWindow) => {
  const transport = getMobileAppTransport(runtimeWindow);
  const normalizedHtml = String(html || '');
  if (!transport || !normalizedHtml.trim()) return false;
  transport.postMessage(JSON.stringify({
    type: MOBILE_APP_PRINT_MESSAGE_TYPE,
    title: String(title || 'Письмо').trim().slice(0, 180) || 'Письмо',
    html: normalizedHtml,
  }));
  return true;
};

const nextRequestId = (runtimeWindow) => {
  const randomUuid = runtimeWindow?.crypto?.randomUUID?.();
  if (randomUuid) return `web-${randomUuid}`;
  commandSequence = (commandSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `web-${Date.now().toString(36)}-${commandSequence.toString(36)}`;
};

const normalizeCommandError = (detail) => {
  const message = String(detail?.error?.message || '').trim();
  const error = new Error(message || 'Android не выполнил команду');
  error.code = String(detail?.error?.code || 'native_command_failed').trim();
  return error;
};

export const requestMobileAppCommand = (
  command,
  payload = {},
  {
    runtimeWindow = typeof window === 'undefined' ? undefined : window,
    timeoutMs = MOBILE_APP_COMMAND_TIMEOUT_MS,
  } = {},
) => {
  const transport = getMobileAppTransport(runtimeWindow);
  const normalizedCommand = String(command || '').trim();
  if (!transport) return Promise.reject(new Error('Функция доступна только в APK HUB-IT'));
  if (!MOBILE_APP_COMMANDS.has(normalizedCommand)) {
    return Promise.reject(new Error('Команда Android не поддерживается'));
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Promise.reject(new Error('Некорректные параметры команды Android'));
  }

  const requestId = nextRequestId(runtimeWindow);
  const message = {
    type: MOBILE_APP_COMMAND_MESSAGE_TYPE,
    schemaVersion: MOBILE_APP_COMMAND_SCHEMA_VERSION,
    requestId,
    command: normalizedCommand,
    payload,
  };
  const serialized = JSON.stringify(message);
  if (new TextEncoder().encode(serialized).byteLength > 16 * 1024) {
    return Promise.reject(new Error('Параметры команды Android слишком большие'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      runtimeWindow.removeEventListener(MOBILE_APP_COMMAND_RESPONSE_EVENT, handleResponse);
      runtimeWindow.clearTimeout(timeoutId);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleResponse = (event) => {
      const detail = event?.detail;
      if (
        detail?.type !== 'hubit.portal.native-command-response'
        || detail?.schemaVersion !== MOBILE_APP_COMMAND_SCHEMA_VERSION
        || detail?.requestId !== requestId
      ) return;
      if (detail.ok === true) finish(resolve, detail.result ?? null);
      else finish(reject, normalizeCommandError(detail));
    };
    const timeoutId = runtimeWindow.setTimeout(() => {
      finish(reject, new Error('Android не ответил вовремя. Повторите действие.'));
    }, Math.max(1_000, Number(timeoutMs) || MOBILE_APP_COMMAND_TIMEOUT_MS));

    runtimeWindow.addEventListener(MOBILE_APP_COMMAND_RESPONSE_EVENT, handleResponse);
    try {
      transport.postMessage(serialized);
    } catch (error) {
      finish(reject, error);
    }
  });
};
