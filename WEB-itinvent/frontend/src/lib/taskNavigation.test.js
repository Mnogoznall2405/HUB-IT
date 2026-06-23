import { describe, expect, it, vi } from 'vitest';

const chatFeature = vi.hoisted(() => ({ taskDiscussion: false }));

vi.mock('./chatFeature', () => ({
  get TASK_DISCUSSION_CHAT_ENABLED() {
    return chatFeature.taskDiscussion;
  },
}));

import {
  buildTaskDetailPath,
  getDefaultTaskDetailTab,
  getTaskNotificationPath,
  normalizeTaskDetailTab,
} from './taskNavigation';

describe('taskNavigation', () => {
  it('defaults to comments tab when task discussion chat is disabled', () => {
    chatFeature.taskDiscussion = false;
    expect(getDefaultTaskDetailTab()).toBe('comments');
    expect(normalizeTaskDetailTab('')).toBe('comments');
    expect(normalizeTaskDetailTab('unexpected')).toBe('comments');
  });

  it('defaults to files tab when task discussion chat is enabled', () => {
    chatFeature.taskDiscussion = true;
    expect(getDefaultTaskDetailTab()).toBe('files');
    expect(normalizeTaskDetailTab('')).toBe('files');
    expect(normalizeTaskDetailTab('history')).toBe('history');
  });

  it('builds task paths without forcing comments tab when discussion chat is enabled', () => {
    chatFeature.taskDiscussion = true;
    expect(buildTaskDetailPath('task-1')).toBe('/tasks?task=task-1');
    expect(buildTaskDetailPath('task-1', { tab: 'comments' })).toBe('/tasks?task=task-1&task_tab=comments');
  });

  it('builds legacy comment deep links when discussion chat is disabled', () => {
    chatFeature.taskDiscussion = false;
    expect(buildTaskDetailPath('task-1')).toBe('/tasks?task=task-1&task_tab=comments');
    expect(getTaskNotificationPath({ entity_type: 'task', entity_id: 'task-1' }))
      .toBe('/tasks?task=task-1&task_tab=comments');
  });

  it('routes legacy comment notifications to archive tab when discussion chat is enabled', () => {
    chatFeature.taskDiscussion = true;
    expect(getTaskNotificationPath({
      entity_type: 'task',
      entity_id: 'task-1',
      event_type: 'task.comment_added',
    })).toBe('/tasks?task=task-1&task_tab=comments');
    expect(getTaskNotificationPath({
      entity_type: 'task',
      entity_id: 'task-1',
      event_type: 'task.assigned',
    })).toBe('/tasks?task=task-1');
  });
});
