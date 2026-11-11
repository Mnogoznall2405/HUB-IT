import apiClient from './client';

// Предложения по улучшению HUB («Предложить улучшение HUB»). Контракт бэкенда: /api/v1/feedback.
export const FEEDBACK_CATEGORY_OPTIONS = [
  { value: 'idea', label: 'Идея' },
  { value: 'inconvenience', label: 'Неудобство' },
  { value: 'bug', label: 'Ошибка' },
  { value: 'other', label: 'Другое' },
];

export const FEEDBACK_CATEGORY_LABELS = Object.fromEntries(
  FEEDBACK_CATEGORY_OPTIONS.map((item) => [item.value, item.label]),
);

export const FEEDBACK_STATUS_META = {
  new: { label: 'Новое', color: 'info' },
  in_progress: { label: 'В работе', color: 'warning' },
  accepted: { label: 'Принято', color: 'primary' },
  declined: { label: 'Отклонено', color: 'error' },
  done: { label: 'Сделано', color: 'success' },
};

export const FEEDBACK_STATUS_ORDER = ['new', 'in_progress', 'accepted', 'declined', 'done'];

export const FEEDBACK_TITLE_MIN = 3;
export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_MESSAGE_MIN = 10;
export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_SECTION_MAX = 64;

export function validateFeedbackDraft({ category, title, message, section }) {
  const errors = {};
  if (!FEEDBACK_CATEGORY_LABELS[category]) errors.category = 'Выберите категорию.';
  const titleLength = String(title || '').trim().length;
  if (titleLength < FEEDBACK_TITLE_MIN) errors.title = `Заголовок: не менее ${FEEDBACK_TITLE_MIN} символов.`;
  else if (titleLength > FEEDBACK_TITLE_MAX) errors.title = `Заголовок: не более ${FEEDBACK_TITLE_MAX} символов.`;
  const messageLength = String(message || '').trim().length;
  if (messageLength < FEEDBACK_MESSAGE_MIN) errors.message = `Описание: не менее ${FEEDBACK_MESSAGE_MIN} символов.`;
  else if (messageLength > FEEDBACK_MESSAGE_MAX) errors.message = `Описание: не более ${FEEDBACK_MESSAGE_MAX} символов.`;
  if (String(section || '').trim().length > FEEDBACK_SECTION_MAX) {
    errors.section = `Раздел: не более ${FEEDBACK_SECTION_MAX} символов.`;
  }
  return errors;
}

export function formatFeedbackDateTime(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getFeedbackErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length) {
    const text = detail
      .map((item) => (typeof item?.msg === 'string' ? item.msg : ''))
      .filter(Boolean)
      .join('; ');
    if (text) return text;
  }
  return fallback;
}

export const feedbackAPI = {
  createSuggestion: async ({ category, title, message, section }) => {
    const payload = { category, title, message };
    if (section) payload.section = section;
    const response = await apiClient.post('/feedback', payload);
    return response.data;
  },

  listMine: async ({ limit = 50 } = {}) => {
    const response = await apiClient.get('/feedback/mine', { params: { limit } });
    return response.data;
  },

  listAdmin: async ({ status = '', limit = 20, offset = 0 } = {}) => {
    const params = { limit, offset };
    if (status) params.status = status;
    const response = await apiClient.get('/feedback', { params });
    return response.data;
  },

  updateSuggestion: async (id, patch) => {
    const response = await apiClient.patch(`/feedback/${encodeURIComponent(id)}`, patch);
    return response.data;
  },
};

export default feedbackAPI;
