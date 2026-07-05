export const EMAIL_DEADLINE_REMIND_HOUR_OPTIONS = [1, 3, 6, 12, 24, 48, 72];

export const fromApiEmailDeadlineRemindHours = (value) => {
  if (value === null || value === undefined || value === '') {
    return { mode: 'default', hours: 24 };
  }
  const hours = Number(value);
  if (hours === 0) return { mode: 'off', hours: 24 };
  if (Number.isFinite(hours) && hours > 0) return { mode: 'custom', hours };
  return { mode: 'default', hours: 24 };
};

export const toApiEmailDeadlineRemindHours = (mode, hours) => {
  if (mode === 'off') return 0;
  if (mode === 'custom') return Number(hours) || 24;
  return null;
};

export const formatEmailRemindSummary = (mode, hours, defaultHours = 24) => {
  if (mode === 'off') return 'Email: не отправлять';
  if (mode === 'custom') return `Email: за ${hours} ч до срока`;
  return `Email: за ${defaultHours} ч`;
};

export const applyDueAtChange = (prev, dueAt) => ({
  ...prev,
  due_at: dueAt,
  ...(dueAt ? {} : { email_deadline_remind_mode: 'default', email_deadline_remind_hours: 24 }),
});
