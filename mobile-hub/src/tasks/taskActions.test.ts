import { getTaskActions } from './taskActions';

describe('getTaskActions', () => {
  it('exposes only actions explicitly allowed by task capabilities', () => {
    expect(getTaskActions({ can_start: true, can_submit: false, can_reopen: true }).map((item) => item.key))
      .toEqual(['start', 'reopen']);
  });

  it('maps review capability to approve and comment-required reject', () => {
    const actions = getTaskActions({ can_review: true });
    expect(actions.map((item) => item.key)).toEqual(['approve', 'reject']);
    expect(actions.find((item) => item.key === 'reject')?.commentRequired).toBe(true);
  });
});
