import { describe, expect, it } from 'vitest';

import {
  buildSandboxPermissionCard,
  sandboxPermissionStatusToCardStatus,
} from './sandboxPermissionCard';

describe('sandboxPermissionStatusToCardStatus', () => {
  it('maps sandbox decisions to card states', () => {
    expect(sandboxPermissionStatusToCardStatus('pending')).toBe('pending');
    expect(sandboxPermissionStatusToCardStatus('approved')).toBe('confirmed');
    expect(sandboxPermissionStatusToCardStatus('rejected')).toBe('cancelled');
  });
});

describe('buildSandboxPermissionCard', () => {
  const envelope = (payload) => ({
    conversation_id: 'conv-1',
    change: 'permission',
    payload,
  });

  it('builds an inline card from a permission event', () => {
    const card = buildSandboxPermissionCard({
      envelope: envelope({
        id: 'perm-1',
        action_id: 'action-1',
        message_id: 'msg-1',
        status: 'pending',
        summary: 'workspace/result-test.txt',
        tool: 'edit',
        arguments: { filepath: 'result-test.txt' },
      }),
      activeConversationId: 'conv-1',
    });
    expect(card).toMatchObject({
      id: 'action-1',
      action_type: 'ai.sandbox.permission',
      status: 'pending',
      message_id: 'msg-1',
    });
    expect(card.preview.title).toBe('Разрешить действие OpenCode');
    expect(card.preview.summary).toBe('workspace/result-test.txt');
  });

  it('marks decided cards as confirmed or cancelled', () => {
    const approved = buildSandboxPermissionCard({
      envelope: envelope({ action_id: 'a', message_id: 'm', status: 'approved' }),
      activeConversationId: 'conv-1',
    });
    const rejected = buildSandboxPermissionCard({
      envelope: envelope({ action_id: 'a', message_id: 'm', status: 'rejected' }),
      activeConversationId: 'conv-1',
    });
    expect(approved.status).toBe('confirmed');
    expect(rejected.status).toBe('cancelled');
  });

  it('ignores other conversations, changes and incomplete payloads', () => {
    expect(buildSandboxPermissionCard({
      envelope: envelope({ action_id: 'a', message_id: 'm', status: 'pending' }),
      activeConversationId: 'conv-2',
    })).toBeNull();
    expect(buildSandboxPermissionCard({
      envelope: { conversation_id: 'conv-1', change: 'job', payload: {} },
      activeConversationId: 'conv-1',
    })).toBeNull();
    expect(buildSandboxPermissionCard({
      envelope: envelope({ action_id: '', message_id: 'm', status: 'pending' }),
      activeConversationId: 'conv-1',
    })).toBeNull();
  });
});
