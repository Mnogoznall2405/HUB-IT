// Пользовательские данные, которые не должны переживать выход из аккаунта на
// общей машине: история поисков почты (`mail_recent_searches_v1:<owner>` — внутри
// фильтры по теме/телу писем) и resume-сессии загрузок MyFiles
// (`hubit-my-files-uploads:<owner>` — имена файлов и папок другого аккаунта).
// synchronizeBrowserAccount снимает только базовый ключ поисков, scoped-ключи
// копились бы бессрочно — выметаем по префиксам.

const LOGOUT_SWEEP_PREFIXES = [
  'mail_recent_searches_v1',
  'hubit-my-files-uploads',
  // Локальный автосейв открытого композера (`mail_compose_draft_v2:mailbox-*`)
  // содержит текст письма — на общей машине не должен переживать выход.
  'mail_compose_draft_v2',
];

const getStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const sweepLogoutSessionData = ({ storage = getStorage() } = {}) => {
  if (!storage) return 0;
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && LOGOUT_SWEEP_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
  } catch {
    return 0;
  }
  keys.forEach((key) => {
    try { storage.removeItem(key); } catch { /* best effort */ }
  });
  return keys.length;
};

export const __LOGOUT_SWEEP_TESTING__ = { LOGOUT_SWEEP_PREFIXES };
