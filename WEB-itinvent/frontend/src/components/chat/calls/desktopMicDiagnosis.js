// Turns the HUB-IT Desktop microphone diagnosis (media.microphoneDiagnosis)
// into the text of the microphone dialog. Browser behaviour is untouched:
// this is used only when the Desktop host advertises microphone-diagnostics.

const BUSY_NAMES = new Set(['NotReadableError', 'AbortError', 'TrackStartError']);
const DENIED_NAMES = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

const PRIVACY = 'privacy-microphone';
const SOUND = 'sound';

const REASONS = {
  appConsentDenied: {
    text: 'Windows запретил HUB-IT доступ к микрофону. Откройте настройки, включите доступ к микрофону для классических приложений и для HUB-IT Desktop, затем нажмите «Повторить».',
    settingsKind: PRIVACY,
  },
  privacyDenied: {
    text: 'Доступ к микрофону запрещён в Параметрах Windows. Включите «Доступ к микрофону» и «Разрешить классическим приложениям доступ к микрофону», затем нажмите «Повторить».',
    settingsKind: PRIVACY,
  },
  noDevices: {
    text: 'Windows не видит ни одного устройства записи. Подключите микрофон или гарнитуру с микрофоном и нажмите «Повторить».',
    settingsKind: SOUND,
  },
  devicesDisabled: {
    text: 'Устройство записи по умолчанию отключено или не подключено. Включите микрофон в Параметрах Windows → Система → Звук → Ввод.',
    settingsKind: SOUND,
  },
  noDefaultDevice: {
    text: 'В Windows не выбрано устройство записи по умолчанию. Выберите микрофон в Параметрах Windows → Система → Звук → Ввод.',
    settingsKind: SOUND,
  },
  exclusiveInUse: {
    text: 'Микрофон занят в монопольном режиме другим приложением: закройте его или снимите галочку «Разрешить приложениям использовать устройство в монопольном режиме» (Звук → Свойства устройства → Дополнительно).',
    settingsKind: SOUND,
  },
  deviceInvalidated: {
    text: 'Устройство записи было отключено или переподключено. Подключите микрофон заново и нажмите «Повторить».',
    settingsKind: SOUND,
  },
  audioServiceStopped: {
    text: 'Служба звука Windows не запущена. Перезагрузите компьютер; если не поможет — обратитесь в IT.',
    settingsKind: SOUND,
  },
  probeFailed: {
    text: 'Windows не смог открыть микрофон. Проверьте устройство записи в Параметрах Windows → Система → Звук → Ввод.',
    settingsKind: SOUND,
  },
};

const WEBVIEW_BLOCKED = {
  text: 'Windows открывает микрофон для HUB-IT, но компонент WebView2 (msedgewebview2.exe) не получает к нему доступ. Похоже, микрофон блокирует антивирус или другое защитное ПО: добавьте HUB-IT Desktop и msedgewebview2.exe в разрешённые (контроль доступа к микрофону) или обратитесь в IT.',
  settingsKind: SOUND,
};

const SITE_REPAIRED_TEXT = 'Сохранённый запрет микрофона для портала снят. Нажмите «Повторить».';

const cleanName = (value) => String(value || '').trim();

const defaultDeviceName = (diagnosis) => cleanName(diagnosis?.defaultConsole?.name);

/**
 * Returns { text, settingsKind, detail } for the dialog, or null when the
 * diagnosis does not explain the failure (the generic text then stays).
 */
export function describeDesktopMicDiagnosis(diagnosis, errorName = '') {
  if (!diagnosis || typeof diagnosis !== 'object') return null;
  const reason = String(diagnosis.reason || '');
  const name = String(errorName || '');
  let entry = REASONS[reason] || null;

  if (reason === 'nativeCaptureOk') {
    if (diagnosis.site?.repaired) {
      entry = { text: SITE_REPAIRED_TEXT, settingsKind: '' };
    } else if (BUSY_NAMES.has(name)) {
      entry = WEBVIEW_BLOCKED;
    } else if (DENIED_NAMES.has(name)) {
      entry = REASONS.appConsentDenied;
    }
  }
  if (!entry) return null;

  const parts = [];
  const device = defaultDeviceName(diagnosis);
  if (device) parts.push(`Устройство по умолчанию: ${device}`);
  if (diagnosis.probeHresult) parts.push(`Windows: ${cleanName(diagnosis.probeHresult)}`);
  if (reason) parts.push(`Диагностика: ${reason}`);
  return { text: entry.text, settingsKind: entry.settingsKind, detail: parts.join(' · ') };
}

/**
 * Desktop variant of the microphone dialog: the user may always continue
 * without a microphone, and the Windows Settings buttons are offered.
 * `diagnosis === undefined` means the host is still being asked.
 */
export function buildDesktopMicPrompt(basePrompt, diagnosis, errorName = '') {
  const prompt = {
    ...basePrompt,
    desktop: true,
    canSkip: true,
    diagnosing: diagnosis === undefined,
    settingsKind: '',
  };
  const described = diagnosis ? describeDesktopMicDiagnosis(diagnosis, errorName) : null;
  if (!described) return prompt;
  return {
    ...prompt,
    text: described.text,
    settingsKind: described.settingsKind,
    detail: [basePrompt?.detail, described.detail].filter(Boolean).join(' · '),
  };
}
