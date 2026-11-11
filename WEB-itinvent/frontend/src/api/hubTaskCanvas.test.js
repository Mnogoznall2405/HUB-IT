import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './client';
import { hubTaskCanvasAPI } from './hubTaskCanvas';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('hubTaskCanvasAPI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and saves a task canvas through the Hub API', async () => {
    apiClient.get.mockResolvedValue({ data: { task_id: 'task/1', revision: 0 } });
    apiClient.put.mockResolvedValue({ data: { task_id: 'task/1', revision: 1 } });

    await expect(hubTaskCanvasAPI.getTaskCanvas('task/1')).resolves.toMatchObject({ revision: 0 });
    await expect(hubTaskCanvasAPI.saveTaskCanvas('task/1', {
      revision: 0,
      scene: { elements: [], appState: {}, files: {} },
    })).resolves.toMatchObject({ revision: 1 });

    expect(apiClient.get).toHaveBeenCalledWith('/hub/tasks/task%2F1/canvas', undefined);
    expect(apiClient.put).toHaveBeenCalledWith('/hub/tasks/task%2F1/canvas', {
      revision: 0,
      scene: { elements: [], appState: {}, files: {} },
    });
  });
});
