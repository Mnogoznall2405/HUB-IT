export type FeedEditorDateFields = {
  publishedFrom: string;
  expiresAt: string;
  pinnedUntil: string;
  pollClosesAt: string;
};

function localDateTimeText(value: string): string {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? value.replace(' ', 'T')
    : value;
}

export function feedDateTimeToIso(value: string): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const date = new Date(localDateTimeText(normalized));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function feedDateTimeInputValue(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

export function validateFeedEditorDates(
  fields: FeedEditorDateFields,
  options: { isPinned: boolean; pollEnabled: boolean; now?: number },
): string {
  const values = [
    ['Дата публикации', fields.publishedFrom],
    ['Дата скрытия', fields.expiresAt],
    ...(options.isPinned ? [['Дата окончания закрепления', fields.pinnedUntil] as const] : []),
    ...(options.pollEnabled ? [['Дата завершения опроса', fields.pollClosesAt] as const] : []),
  ] as const;
  for (const [label, value] of values) {
    if (String(value || '').trim() && !feedDateTimeToIso(value)) return `${label} указана неверно.`;
  }
  const now = options.now ?? Date.now();
  const publishedAt = feedDateTimeToIso(fields.publishedFrom);
  const expiresAt = feedDateTimeToIso(fields.expiresAt);
  const pollClosesAt = options.pollEnabled ? feedDateTimeToIso(fields.pollClosesAt) : null;
  if (expiresAt && new Date(expiresAt).getTime() <= now) return 'Дата скрытия должна быть в будущем.';
  if (expiresAt && publishedAt && new Date(expiresAt).getTime() <= new Date(publishedAt).getTime()) {
    return 'Дата скрытия должна быть позже даты публикации.';
  }
  if (pollClosesAt && new Date(pollClosesAt).getTime() <= now) {
    return 'Дата завершения опроса должна быть в будущем.';
  }
  if (pollClosesAt && publishedAt && new Date(pollClosesAt).getTime() <= new Date(publishedAt).getTime()) {
    return 'Дата завершения опроса должна быть позже даты публикации.';
  }
  return '';
}

export function validateFeedPoll(question: string, options: string[]): string {
  const normalizedQuestion = String(question || '').trim();
  const normalizedOptions = options.map((option) => String(option || '').trim());
  if (normalizedQuestion.length < 3) return 'Вопрос опроса должен содержать не меньше 3 символов.';
  if (normalizedOptions.length < 2 || normalizedOptions.some((option) => !option)) {
    return 'Добавьте не меньше двух непустых вариантов ответа.';
  }
  if (normalizedOptions.length > 10) return 'В опросе может быть не больше 10 вариантов.';
  if (new Set(normalizedOptions.map((option) => option.toLocaleLowerCase('ru-RU'))).size !== normalizedOptions.length) {
    return 'Варианты ответа не должны повторяться.';
  }
  return '';
}

export function filterFeedRecipients<T extends { full_name?: string | null; username?: string | null }>(
  users: T[],
  query: string,
  limit = 20,
): T[] {
  const tokens = String(query || '').trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit || 20)));
  return users.filter((user) => {
    if (!tokens.length) return true;
    const haystack = `${user.full_name || ''} ${user.username || ''}`.toLocaleLowerCase('ru-RU');
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, boundedLimit);
}
