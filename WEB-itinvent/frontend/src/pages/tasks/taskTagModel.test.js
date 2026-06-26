import { describe, expect, it } from 'vitest';
import { alpha } from '@mui/material/styles';

import { buildTaskTagChips } from './taskTagModel';

const ui = {
  mutedText: '#64748b',
  actionBg: '#f1f5f9',
};

describe('taskTagModel', () => {
  it('builds status and overdue chips', () => {
    const chips = buildTaskTagChips(
      { status: 'review', priority: 'normal', is_overdue: true },
      { ui, taskDiscussionChatEnabled: false, alpha },
    );
    expect(chips.map((item) => item.key)).toEqual(['status', 'overdue']);
  });

  it('includes files and checklist counters', () => {
    const chips = buildTaskTagChips(
      {
        status: 'in_progress',
        priority: 'high',
        attachments_count: 2,
        comments_count: 3,
        has_unread_comments: true,
        checklist_total: 4,
        checklist_done: 1,
      },
      { ui, taskDiscussionChatEnabled: true, alpha },
    );
    expect(chips.find((item) => item.key === 'files')?.label).toBe('Файлы 2');
    expect(chips.find((item) => item.key === 'comments')?.label).toBe('Архив 3');
    expect(chips.find((item) => item.key === 'checklist')?.label).toBe('Чек-лист 1/4');
  });
});
