import { groupFilesBlockReason, groupPostingBlockReason, groupSlowModeLabel } from './chatModels';

describe('groupPostingBlockReason', () => {
  it('blocks everyone in a closed group and only plain members in a managers-only group', () => {
    expect(groupPostingBlockReason({ kind: 'group', posting_policy: 'closed', viewer_member_role: 'owner' }))
      .toContain('закрыта');
    expect(groupPostingBlockReason({ kind: 'group', posting_policy: 'managers', viewer_member_role: 'member' }))
      .toContain('только владелец и модераторы');
    expect(groupPostingBlockReason({ kind: 'group', posting_policy: 'managers', viewer_member_role: 'moderator' })).toBe('');
  });

  it('leaves the decision to the server when the role or policy is unknown or the chat is not a group', () => {
    expect(groupPostingBlockReason({ kind: 'group', posting_policy: 'managers', viewer_member_role: null })).toBe('');
    expect(groupPostingBlockReason({ kind: 'group', posting_policy: null, viewer_member_role: 'member' })).toBe('');
    expect(groupPostingBlockReason({ kind: 'direct', posting_policy: 'closed', viewer_member_role: 'member' })).toBe('');
  });
});

describe('groupPostingBlockReason for a restricted member', () => {
  const NOW = Date.parse('2026-10-13T10:00:00Z');

  it('blocks until lifted or until the term ends, and not after it', () => {
    const base = { kind: 'group' as const, posting_policy: 'all', viewer_member_role: 'member', viewer_restricted: true };
    expect(groupPostingBlockReason({ ...base, viewer_restricted_until: null }, NOW))
      .toBe('Вам ограничена отправка сообщений в этой группе.');
    expect(groupPostingBlockReason({ ...base, viewer_restricted_until: '2026-10-14T10:00:00Z' }, NOW))
      .toContain('Вам ограничена отправка сообщений до');
    expect(groupPostingBlockReason({ ...base, viewer_restricted_until: '2026-10-13T09:00:00Z' }, NOW)).toBe('');
  });

  it('keeps the group rule first when both apply', () => {
    expect(groupPostingBlockReason({
      kind: 'group', posting_policy: 'closed', viewer_member_role: 'member', viewer_restricted: true,
    }, NOW)).toBe('Группа закрыта: писать в неё нельзя.');
  });
});

describe('groupFilesBlockReason', () => {
  it('blocks plain members only while the group forbids files', () => {
    const forbidden = { kind: 'group' as const, members_send_files: false };
    expect(groupFilesBlockReason({ ...forbidden, viewer_member_role: 'member' }))
      .toBe('В этой группе файлы могут отправлять только владелец и модераторы.');
    expect(groupFilesBlockReason({ ...forbidden, viewer_member_role: 'moderator' })).toBe('');
    expect(groupFilesBlockReason({ ...forbidden, viewer_member_role: 'owner' })).toBe('');
    expect(groupFilesBlockReason({ ...forbidden, viewer_member_role: null })).toBe('');
    expect(groupFilesBlockReason({ kind: 'group', members_send_files: true, viewer_member_role: 'member' })).toBe('');
    expect(groupFilesBlockReason({ kind: 'direct', members_send_files: false, viewer_member_role: 'member' })).toBe('');
  });
});

describe('groupMentionAllCandidate', () => {
  it('is offered only to the owner and moderators of a group', () => {
    const { groupMentionAllCandidate } = require('./chatModels');
    expect(groupMentionAllCandidate({ kind: 'group', viewer_member_role: 'owner' })?.username).toBe('все');
    expect(groupMentionAllCandidate({ kind: 'group', viewer_member_role: 'moderator' })).not.toBeNull();
    expect(groupMentionAllCandidate({ kind: 'group', viewer_member_role: 'member' })).toBeNull();
    expect(groupMentionAllCandidate({ kind: 'direct', viewer_member_role: 'owner' })).toBeNull();
  });
});

describe('groupSlowModeLabel', () => {
  it('names the interval only for groups with slow mode on', () => {
    expect(groupSlowModeLabel({ kind: 'group', slow_mode_seconds: 30 })).toBe('Медленный режим: 30 с');
    expect(groupSlowModeLabel({ kind: 'group', slow_mode_seconds: 300 })).toBe('Медленный режим: 5 мин');
    expect(groupSlowModeLabel({ kind: 'group', slow_mode_seconds: 3600 })).toBe('Медленный режим: 1 ч');
    expect(groupSlowModeLabel({ kind: 'group', slow_mode_seconds: 0 })).toBe('');
    expect(groupSlowModeLabel({ kind: 'direct', slow_mode_seconds: 30 })).toBe('');
  });
});
