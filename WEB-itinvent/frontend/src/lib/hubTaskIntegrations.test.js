import { describe, expect, it } from 'vitest';

import {
  canOpenTransferActUpload,
  getTransferActPendingGroupsCount,
  getTransferActReminderLabel,
  getTransferActUploadUrl,
  isTransferActUploadCompleted,
  isTransferActUploadTask,
} from './hubTaskIntegrations';

describe('hub task integration helpers', () => {
  it('detects transfer-act reminder tasks', () => {
    expect(isTransferActUploadTask({ integration_kind: 'transfer_act_upload' })).toBe(true);
    expect(isTransferActUploadTask({ integration_kind: 'manual' })).toBe(false);
  });

  it('reads upload url and pending groups count from integration payload', () => {
    const task = {
      integration_kind: 'transfer_act_upload',
      integration_payload: {
        upload_url: '/database?upload_act=1&reminder_id=abc',
        pending_groups_total: 3,
      },
    };

    expect(getTransferActUploadUrl(task)).toBe('/database?upload_act=1&reminder_id=abc');
    expect(getTransferActPendingGroupsCount(task)).toBe(3);
  });

  it('keeps upload CTA only for open reminders with pending acts', () => {
    const openTask = {
      integration_kind: 'transfer_act_upload',
      status: 'in_progress',
      integration_payload: {
        upload_url: '/database?upload_act=1&reminder_id=abc',
        pending_groups_total: 2,
      },
    };
    const completedTask = {
      integration_kind: 'transfer_act_upload',
      status: 'done',
      integration_payload: {
        upload_url: '/database?upload_act=1&reminder_id=abc',
        pending_groups_total: 0,
      },
    };

    expect(canOpenTransferActUpload(openTask)).toBe(true);
    expect(isTransferActUploadCompleted(openTask)).toBe(false);
    expect(getTransferActReminderLabel(openTask)).toBe('Осталось актов: 2');

    expect(canOpenTransferActUpload(completedTask)).toBe(false);
    expect(isTransferActUploadCompleted(completedTask)).toBe(true);
    expect(getTransferActReminderLabel(completedTask)).toBe('Акты загружены');
  });
});
