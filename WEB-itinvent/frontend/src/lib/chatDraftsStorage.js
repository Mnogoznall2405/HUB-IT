// Черновики чата хранятся в localStorage как обычные строки под ключами
// `chat:draft:<userId>:<conversationId>` — несколько читателей ждут именно raw text,
// поэтому возраст ведём в отдельном индексе `chat:draft-meta`, не меняя формат значения.
// Без этого ключи копились бы бессрочно: ни TTL, ни лимита, ни очистки при выходе.

const DRAFT_KEY_PREFIX = 'chat:draft:';
const DRAFT_META_KEY = 'chat:draft-meta';

// After logout the page tree still unmounts and its cleanup flushes pending
// drafts back into storage — sealing makes every post-sweep write a no-op until
// the next session's sweepChatDrafts() opens drafts again.
let draftWritesSealed = false;
export const sealChatDraftWrites = () => { draftWritesSealed = true; };
export const chatDraftWritesSealed = () => draftWritesSealed;

export const CHAT_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_DRAFT_MAX_KEYS = 200;

const getStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const readDraftMeta = (storage) => {
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_META_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeDraftMeta = (storage, meta) => {
  try {
    if (Object.keys(meta).length) storage.setItem(DRAFT_META_KEY, JSON.stringify(meta));
    else storage.removeItem(DRAFT_META_KEY);
  } catch {
    // Draft bookkeeping is best-effort.
  }
};

const listDraftKeys = (storage) => {
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    // Storage enumeration is best-effort.
  }
  return keys;
};

export const recordChatDraftWrite = (storageKey, { now = Date.now(), storage = getStorage() } = {}) => {
  const key = String(storageKey || '').trim();
  if (!key.startsWith(DRAFT_KEY_PREFIX) || !storage) return;
  const meta = readDraftMeta(storage);
  meta[key] = now;
  writeDraftMeta(storage, meta);
};

export const recordChatDraftClear = (storageKey, { storage = getStorage() } = {}) => {
  const key = String(storageKey || '').trim();
  if (!key.startsWith(DRAFT_KEY_PREFIX) || !storage) return;
  const meta = readDraftMeta(storage);
  if (!Object.prototype.hasOwnProperty.call(meta, key)) return;
  delete meta[key];
  writeDraftMeta(storage, meta);
};

// Прогоняется при входе в чат: черновики старше TTL и хвост за пределами cap
// удаляются; ключи без записи в индексе (созданные до его появления) считаются
// свежими и получают текущую метку — живые черновики не теряются при переходе.
export const sweepChatDrafts = ({ now = Date.now(), storage = getStorage() } = {}) => {
  draftWritesSealed = false;
  if (!storage) return 0;
  const keys = listDraftKeys(storage);
  if (!keys.length) return 0;
  const keySet = new Set(keys);
  const meta = readDraftMeta(storage);
  let metaChanged = false;
  Object.keys(meta).forEach((key) => {
    if (!keySet.has(key)) { delete meta[key]; metaChanged = true; }
  });
  const entries = keys.map((key) => {
    const savedAt = Number(meta[key]) || 0;
    if (!savedAt) { meta[key] = now; metaChanged = true; }
    return { key, savedAt: savedAt || now };
  }).sort((a, b) => b.savedAt - a.savedAt);
  let removed = 0;
  entries.forEach((entry, index) => {
    if (index >= CHAT_DRAFT_MAX_KEYS || now - entry.savedAt > CHAT_DRAFT_TTL_MS) {
      try { storage.removeItem(entry.key); } catch { /* best effort */ }
      delete meta[entry.key];
      metaChanged = true;
      removed += 1;
    }
  });
  if (metaChanged) writeDraftMeta(storage, meta);
  return removed;
};

// Выход из аккаунта: черновики — пользовательский текст в открытом виде,
// на общей машине они не должны переживать сессию.
export const clearAllChatDrafts = ({ storage = getStorage() } = {}) => {
  sealChatDraftWrites();
  if (!storage) return 0;
  const keys = listDraftKeys(storage);
  keys.forEach((key) => {
    try { storage.removeItem(key); } catch { /* best effort */ }
  });
  try { storage.removeItem(DRAFT_META_KEY); } catch { /* best effort */ }
  return keys.length;
};
