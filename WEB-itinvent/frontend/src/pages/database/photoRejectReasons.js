// Быстрые причины отказа фото: типовые + последние использованные этим проверяющим.
export const MAX_REJECT_REASON = 500;

export const PHOTO_REJECT_REASON_PRESETS = [
  'Размытое фото',
  'Не тот предмет',
  'Не виден инвентарный номер',
  'Не виден серийный номер',
  'Плохое освещение',
  'Нужен общий план',
];

const RECENT_KEY = 'equipment_photo_reject_recent_reasons';
const MAX_RECENT = 5;

export const loadRecentRejectReasons = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || '').trim())
      .filter((value) => value && !PHOTO_REJECT_REASON_PRESETS.includes(value))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
};

export const rememberRejectReason = (reason) => {
  const text = String(reason || '').trim();
  if (!text || PHOTO_REJECT_REASON_PRESETS.includes(text) || text.length > 80) return;
  try {
    const next = [text, ...loadRecentRejectReasons().filter((item) => item !== text)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Без хранилища (приватный режим) чипы просто не запоминаются.
  }
};

// Чип добавляет причину к уже введённому тексту, не затирая его.
export const appendRejectReason = (current, preset) => {
  const text = String(current || '').trim();
  const addition = String(preset || '').trim();
  if (!addition) return text;
  if (!text) return addition.slice(0, MAX_REJECT_REASON);
  if (text.toLowerCase().includes(addition.toLowerCase())) return text;
  return `${text}; ${addition}`.slice(0, MAX_REJECT_REASON);
};
