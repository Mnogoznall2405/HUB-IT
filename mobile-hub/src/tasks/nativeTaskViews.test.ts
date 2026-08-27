import type { HubTask } from '../api/taskApi';
import { buildNativeTaskListSections } from './nativeTaskViews';

function task(id: string, status: string, dueAt: string, updatedAt: string): HubTask {
  return { id, title: id, status, due_at: dueAt, updated_at: updatedAt };
}

describe('native task list sections', () => {
  it('keeps completed tasks separate and orders active tasks like the web mobile feed', () => {
    const sections = buildNativeTaskListSections([
      task('new-later', 'new', '2026-09-10T12:00:00Z', '2026-08-27T08:00:00Z'),
      task('in-progress-sooner', 'in_progress', '2026-08-29T12:00:00Z', '2026-08-27T09:00:00Z'),
      task('done', 'done', '2026-08-20T12:00:00Z', '2026-08-27T10:00:00Z'),
    ], new Date('2026-08-27T12:00:00Z'));

    expect(sections.active.items.map((item) => item.id)).toEqual([
      'in-progress-sooner',
      'new-later',
    ]);
    expect(sections.completed.items.map((item) => item.id)).toEqual(['done']);
  });
});
