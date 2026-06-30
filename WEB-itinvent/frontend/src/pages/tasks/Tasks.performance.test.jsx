import { describe, expect, it } from 'vitest';

import {
  preloadTasksAnalyticsBundle,
  preloadTasksAnalyticsView,
} from '../../components/hub/tasks/TasksDataModeRouter';

describe('Tasks performance helpers', () => {
  it('preloads analytics view and charts as separate dynamic imports', async () => {
    const bundle = await preloadTasksAnalyticsBundle();
    expect(bundle).toHaveLength(2);
    expect(bundle[0]).toHaveProperty('default');
    expect(bundle[1]).toHaveProperty('default');
  });

  it('exposes preloadTasksAnalyticsView as analytics bundle alias', async () => {
    const view = await preloadTasksAnalyticsView();
    expect(view).toHaveLength(2);
  });

  it('lazy-loads board view chunk on demand', async () => {
    const module = await import('../../components/hub/tasks/TasksBoardView');
    expect(module.default).toBeTypeOf('function');
  });

  it('lazy-loads calendar view chunk on demand', async () => {
    const module = await import('../../components/hub/tasks/TasksCalendarView');
    expect(module.default).toBeTypeOf('function');
  });

  it('lazy-loads gantt view chunk on demand', async () => {
    const module = await import('../../components/hub/tasks/TasksGanttView');
    expect(module.default).toBeTypeOf('function');
  });

  it('lazy-loads create dialog chunk on demand', async () => {
    const module = await import('../../components/hub/tasks/TasksCreateDialog');
    expect(module.default).toBeTypeOf('function');
  });
});
