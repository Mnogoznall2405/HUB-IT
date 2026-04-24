const RE_PREFIX_RE = /^re:\s*/i;
const FWD_PREFIX_RE = /^(fw|fwd):\s*/i;

export const EMPTY_REPLY_SUBJECT = '(без темы)';

export const normalizeComposeSubject = (mode, subjectValue) => {
  const subject = String(subjectValue ?? '').trim();

  if (mode === 'reply' || mode === 'reply_all') {
    const replySubject = subject || EMPTY_REPLY_SUBJECT;
    return RE_PREFIX_RE.test(replySubject) ? replySubject : `Re: ${replySubject}`;
  }

  if (mode === 'forward') {
    const forwardSubject = subject || EMPTY_REPLY_SUBJECT;
    return FWD_PREFIX_RE.test(forwardSubject) ? forwardSubject : `Fwd: ${forwardSubject}`;
  }

  return subject;
};
