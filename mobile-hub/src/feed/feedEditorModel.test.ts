import {
  feedDateTimeInputValue,
  feedDateTimeToIso,
  filterFeedRecipients,
  validateFeedEditorDates,
  validateFeedPoll,
} from './feedEditorModel';

it('parses local and ISO date-time text without accepting invalid values', () => {
  expect(feedDateTimeToIso('2026-08-25 10:30')).toMatch(/^2026-08-25T/);
  expect(feedDateTimeToIso('not-a-date')).toBeNull();
  expect(feedDateTimeInputValue('2026-08-25T10:30:00.000Z')).toMatch(/^2026-08-25 \d{2}:30$/);
});

it('validates publication and poll chronology', () => {
  const now = new Date('2026-08-24T10:00:00Z').getTime();
  expect(validateFeedEditorDates({
    publishedFrom: '2026-08-25T10:00:00Z',
    expiresAt: '2026-08-24T09:00:00Z',
    pinnedUntil: '',
    pollClosesAt: '',
  }, { isPinned: false, pollEnabled: false, now })).toBe('Дата скрытия должна быть в будущем.');
  expect(validateFeedEditorDates({
    publishedFrom: '2026-08-25T10:00:00Z',
    expiresAt: '2026-08-26T10:00:00Z',
    pinnedUntil: '',
    pollClosesAt: '2026-08-25T09:00:00Z',
  }, { isPinned: false, pollEnabled: true, now })).toBe('Дата завершения опроса должна быть позже даты публикации.');
});

it('validates unique poll options and bounds recipient results', () => {
  expect(validateFeedPoll('Выбор', ['Да', 'да'])).toBe('Варианты ответа не должны повторяться.');
  const users = Array.from({ length: 30 }, (_, index) => ({ full_name: `Иван ${index}`, username: `user${index}` }));
  expect(filterFeedRecipients(users, 'Иван', 20)).toHaveLength(20);
  expect(filterFeedRecipients(users, 'user29', 20)).toEqual([users[29]]);
});
