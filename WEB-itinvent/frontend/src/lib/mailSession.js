import { isDesktopBridgeReady } from './desktopBridge';

const STORAGE_KEY = 'hubit.mail.device-choice';
export const MAIL_SESSION_CHANGED_EVENT = 'hubit:mail-session-changed';

let memoryChoices = {};

const normalizeLogin = (login) => String(login || '').trim().toLowerCase();

const currentLogin = () => {
  try {
    const raw = window.localStorage?.getItem('user');
    return normalizeLogin(JSON.parse(raw)?.username);
  } catch {
    return '';
  }
};

const readChoicesMap = () => {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeChoicesMap = (map) => {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage may be unavailable; the in-memory map still holds the choice.
  }
};

/**
 * The opt-in question is shown only inside the HUB Desktop (WebView2) shell.
 * Browser, PWA and mobile sessions keep mail always enabled.
 */
export function isMailSessionChoiceRequired() {
  return isDesktopBridgeReady();
}

export function getMailSessionChoice(login = currentLogin()) {
  const key = normalizeLogin(login);
  const stored = readChoicesMap()[key];
  if (stored === 'enabled' || stored === 'disabled') return stored;
  const memory = memoryChoices[key];
  return memory === 'enabled' || memory === 'disabled' ? memory : null;
}

export function setMailSessionChoice(choice, login = currentLogin()) {
  const key = normalizeLogin(login);
  const normalized = choice === 'enabled' || choice === 'disabled' ? choice : null;
  memoryChoices = { ...memoryChoices, [key]: normalized };
  const map = readChoicesMap();
  if (normalized === null) delete map[key];
  else map[key] = normalized;
  writeChoicesMap(map);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(MAIL_SESSION_CHANGED_EVENT));
  }
}

/**
 * Until the desktop user answers, mail stays off: no unread polling and no
 * navigation entry. Everywhere else it is enabled unconditionally.
 */
export function isMailSessionEnabled(login) {
  if (!isMailSessionChoiceRequired()) return true;
  return getMailSessionChoice(login) === 'enabled';
}

// Other HUB Desktop windows share localStorage; `storage` events fire only in
// the windows that did not make the change — bridge them into the in-app event.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event?.key === STORAGE_KEY) {
      memoryChoices = readChoicesMap();
      window.dispatchEvent(new Event(MAIL_SESSION_CHANGED_EVENT));
    }
  });
}
