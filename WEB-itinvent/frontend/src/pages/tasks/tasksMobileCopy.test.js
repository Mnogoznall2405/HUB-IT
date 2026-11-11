import { describe, expect, it } from 'vitest';

import { TASKS_MOBILE_COPY } from './tasksMobileCopy';

describe('tasksMobileCopy', () => {
  it('exposes stable mobile navigation labels', () => {
    expect(TASKS_MOBILE_COPY.tasksTitle).toBe('Задачи');
    expect(TASKS_MOBILE_COPY.feedTitle).toBe('Лента');
    expect(TASKS_MOBILE_COPY.drawerTitle).toBe('Ещё и фильтры');
  });

  it('keeps search placeholder for mobile filters', () => {
    expect(TASKS_MOBILE_COPY.searchPlaceholder).toMatch(/заголовок/i);
  });
});
