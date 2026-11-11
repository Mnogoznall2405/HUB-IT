import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskCanvasWorkspace from './TaskCanvasWorkspace';
import hubTaskCanvasAPI from '../../../api/hubTaskCanvas';

const canvasHarness = vi.hoisted(() => ({
  socketOptions: null,
  onChange: null,
  sceneElements: [],
  appState: {},
  files: {},
  excalidrawApi: {
    addFiles: vi.fn(),
    getAppState: vi.fn(() => canvasHarness.appState),
    getFiles: vi.fn(() => canvasHarness.files),
    getSceneElementsIncludingDeleted: vi.fn(() => canvasHarness.sceneElements),
    updateScene: vi.fn((update) => {
      if (Array.isArray(update?.elements)) canvasHarness.sceneElements = update.elements;
    }),
  },
  socket: {
    connect: vi.fn(),
    close: vi.fn(),
    sendCursor: vi.fn(() => true),
    sendScene: vi.fn(() => true),
  },
}));

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { NEVER: 'never' },
  Excalidraw: ({ excalidrawAPI, isCollaborating, onChange, onPointerUpdate, viewModeEnabled }) => {
    excalidrawAPI?.(canvasHarness.excalidrawApi);
    canvasHarness.onChange = onChange;
    return (
      <button
        type="button"
        aria-label="Тестовый холст"
        data-collaborating={String(isCollaborating)}
        data-read-only={String(viewModeEnabled)}
        onClick={() => {
          canvasHarness.sceneElements = [{ id: 'rect-1', type: 'rectangle', version: 1 }];
          canvasHarness.appState = { viewBackgroundColor: '#ffffff', scrollX: 500 };
          onChange(canvasHarness.sceneElements, canvasHarness.appState, {});
        }}
        onPointerMove={() => onPointerUpdate?.({
          pointer: { x: 10, y: 20, tool: 'pointer' },
          button: 'up',
        })}
      >
        Холст
      </button>
    );
  },
  getSceneVersion: (elements) => elements.reduce((sum, item) => sum + Number(item.version || 0), 0),
  reconcileElements: (localElements, remoteElements) => {
    const byId = new Map(remoteElements.map((element) => [element.id, element]));
    localElements.forEach((element) => {
      const remote = byId.get(element.id);
      if (!remote || Number(element.version || 0) >= Number(remote.version || 0)) {
        byId.set(element.id, element);
      }
    });
    return Array.from(byId.values());
  },
}));

vi.mock('../../../api/hubTaskCanvas', () => ({
  default: {
    getTaskCanvas: vi.fn(),
    saveTaskCanvas: vi.fn(),
  },
}));

vi.mock('../../../lib/taskCanvasSocket', () => ({
  createTaskCanvasSocket: vi.fn((options) => {
    canvasHarness.socketOptions = options;
    return canvasHarness.socket;
  }),
}));

const theme = createTheme();
const emptyCanvas = {
  task_id: 'task-1',
  revision: 0,
  scene: { elements: [], appState: {}, files: {} },
  can_edit: true,
  max_scene_bytes: 2 * 1024 * 1024,
  updated_by_user_id: null,
  updated_by_username: '',
  updated_at: null,
};

const renderCanvas = () => render(
  <ThemeProvider theme={theme}>
    <TaskCanvasWorkspace
      task={{ id: 'task-1', title: 'Нарисовать схему', status: 'in_progress' }}
      theme={theme}
    />
  </ThemeProvider>,
);

describe('TaskCanvasWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hubTaskCanvasAPI.getTaskCanvas.mockReset();
    hubTaskCanvasAPI.saveTaskCanvas.mockReset();
    canvasHarness.socketOptions = null;
    canvasHarness.onChange = null;
    canvasHarness.sceneElements = [];
    canvasHarness.appState = {};
    canvasHarness.files = {};
    hubTaskCanvasAPI.getTaskCanvas.mockResolvedValue(emptyCanvas);
    hubTaskCanvasAPI.saveTaskCanvas.mockResolvedValue({ ...emptyCanvas, revision: 1 });
  });

  it('loads an editable scene and saves only durable app state', async () => {
    renderCanvas();

    const canvas = await screen.findByRole('button', { name: 'Тестовый холст' });
    expect(canvas).toHaveAttribute('data-read-only', 'false');
    fireEvent.click(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenCalledWith('task-1', {
        revision: 0,
        scene: {
          elements: [{ id: 'rect-1', type: 'rectangle', version: 1 }],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        },
      });
    });
    expect(await screen.findByText('Изменения сохранены')).toBeInTheDocument();
  });

  it('fills the remaining task viewport without imposing a minimum page height', async () => {
    renderCanvas();

    await screen.findByRole('button', { name: 'Тестовый холст' });
    const workspaceStyles = getComputedStyle(screen.getByTestId('task-canvas-workspace'));
    const surfaceStyles = getComputedStyle(screen.getByTestId('task-canvas-surface'));

    expect(workspaceStyles.minHeight).toBe('0');
    expect(workspaceStyles.overflow).toBe('hidden');
    expect(surfaceStyles.minHeight).toBe('0');
    expect(surfaceStyles.flexGrow).toBe('1');
  });

  it('expands to the viewport without reconnecting and exits with Escape', async () => {
    renderCanvas();

    await screen.findByRole('button', { name: 'Тестовый холст' });
    const workspace = screen.getByTestId('task-canvas-workspace');
    Object.defineProperty(workspace, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });

    const expandButton = screen.getByRole('button', { name: 'Развернуть доску на весь экран' });
    fireEvent.click(expandButton);

    expect(workspace).toHaveAttribute('data-fullscreen', 'true');
    expect(workspace).toHaveAttribute('role', 'dialog');
    expect(workspace).toHaveAttribute('aria-modal', 'true');
    expect(getComputedStyle(workspace).position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Вернуть доску в карточку' })).toHaveAttribute('aria-pressed', 'true');
    expect(canvasHarness.socket.connect).toHaveBeenCalledTimes(1);
    expect(canvasHarness.socket.close).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(workspace).toHaveAttribute('data-fullscreen', 'false'));
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('button', { name: 'Развернуть доску на весь экран' })).toHaveFocus();
    expect(canvasHarness.socket.connect).toHaveBeenCalledTimes(1);
    expect(canvasHarness.socket.close).not.toHaveBeenCalled();
  });

  it('shows observer access as read-only', async () => {
    hubTaskCanvasAPI.getTaskCanvas.mockResolvedValue({ ...emptyCanvas, can_edit: false });
    renderCanvas();

    expect(await screen.findByText('У вас есть доступ к просмотру этой доски без редактирования.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Тестовый холст' })).toHaveAttribute('data-read-only', 'true');
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
  });

  it('connects collaboration, shows participants and forwards the local cursor', async () => {
    renderCanvas();

    const surface = await screen.findByRole('button', { name: 'Тестовый холст' });
    expect(canvasHarness.socket.connect).toHaveBeenCalledTimes(1);

    act(() => {
      canvasHarness.socketOptions.onStatus('connected');
      canvasHarness.socketOptions.onEvent({
        type: 'task_canvas.connected',
        payload: {
          connection_id: 'own-1',
          collaborator: { id: '7', socketId: 'own-1', username: 'Автор' },
          can_edit: true,
          revision: 0,
          scene: emptyCanvas.scene,
        },
      });
      canvasHarness.socketOptions.onEvent({
        type: 'task_canvas.cursor',
        payload: {
          connection_id: 'peer-2',
          collaborator: { id: '8', socketId: 'peer-2', username: 'Коллега' },
          pointer: { x: 35, y: 45, tool: 'pointer' },
          button: 'up',
        },
      });
    });

    expect(screen.getByTestId('task-canvas-realtime-status')).toHaveTextContent('На доске: 2');
    expect(surface).toHaveAttribute('data-collaborating', 'true');
    const collaboratorUpdate = canvasHarness.excalidrawApi.updateScene.mock.calls
      .map(([update]) => update)
      .find((update) => update?.collaborators?.has('peer-2'));
    expect(collaboratorUpdate.collaborators.get('peer-2')).toEqual(expect.objectContaining({
      username: 'Коллега',
      pointer: { x: 35, y: 45, tool: 'pointer' },
    }));

    fireEvent.pointerMove(surface);
    expect(canvasHarness.socket.sendCursor).toHaveBeenCalledWith({
      pointer: { x: 10, y: 20, tool: 'pointer' },
      button: 'up',
    });
  });

  it('applies a remote-only scene without scheduling another durable save', async () => {
    renderCanvas();

    await screen.findByRole('button', { name: 'Тестовый холст' });
    act(() => {
      canvasHarness.socketOptions.onEvent({
        type: 'task_canvas.scene.updated',
        payload: {
          connection_id: 'peer-2',
          collaborator: { id: '8', socketId: 'peer-2', username: 'Коллега' },
          scene: {
            elements: [{ id: 'ellipse-remote', type: 'ellipse', version: 3 }],
            appState: { gridModeEnabled: true },
            files: {},
          },
        },
      });
    });

    expect(canvasHarness.sceneElements).toEqual([
      { id: 'ellipse-remote', type: 'ellipse', version: 3 },
    ]);
    act(() => {
      canvasHarness.onChange(
        canvasHarness.sceneElements,
        { gridModeEnabled: true },
        {},
      );
    });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(hubTaskCanvasAPI.saveTaskCanvas).not.toHaveBeenCalled();
  });

  it('merges a revision conflict and retries without discarding either scene', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { detail: { message: 'Revision conflict' } } },
    });
    hubTaskCanvasAPI.getTaskCanvas
      .mockResolvedValueOnce(emptyCanvas)
      .mockResolvedValueOnce({
        ...emptyCanvas,
        revision: 2,
        scene: {
          elements: [{ id: 'ellipse-remote', type: 'ellipse', version: 3 }],
          appState: { gridModeEnabled: true },
          files: {},
        },
      });
    hubTaskCanvasAPI.saveTaskCanvas
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ ...emptyCanvas, revision: 3 });
    renderCanvas();

    fireEvent.click(await screen.findByRole('button', { name: 'Тестовый холст' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenCalledTimes(2));
    expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenLastCalledWith('task-1', {
      revision: 2,
      scene: {
        elements: [
          { id: 'ellipse-remote', type: 'ellipse', version: 3 },
          { id: 'rect-1', type: 'rectangle', version: 1 },
        ],
        appState: { gridModeEnabled: true, viewBackgroundColor: '#ffffff' },
        files: {},
      },
    });
    expect(await screen.findByText('Изменения сохранены')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить доску' })).not.toBeInTheDocument();
  });

  it('automatically reconciles a burst of revision conflicts without blocking the canvas', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { detail: { message: 'Revision conflict' } } },
    });
    hubTaskCanvasAPI.getTaskCanvas
      .mockResolvedValueOnce(emptyCanvas)
      .mockResolvedValueOnce({ ...emptyCanvas, revision: 1 })
      .mockResolvedValueOnce({ ...emptyCanvas, revision: 2 })
      .mockResolvedValueOnce({ ...emptyCanvas, revision: 3 });
    hubTaskCanvasAPI.saveTaskCanvas
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ ...emptyCanvas, revision: 4 });
    renderCanvas();

    fireEvent.click(await screen.findByRole('button', { name: 'Тестовый холст' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenCalledTimes(4));
    expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenLastCalledWith('task-1', expect.objectContaining({
      revision: 3,
    }));
    expect(await screen.findByText('Изменения сохранены')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить доску' })).not.toBeInTheDocument();
  });

  it('flushes a pending scene when the canvas view closes before autosave', async () => {
    const { unmount } = renderCanvas();

    fireEvent.click(await screen.findByRole('button', { name: 'Тестовый холст' }));
    unmount();

    await waitFor(() => {
      expect(hubTaskCanvasAPI.saveTaskCanvas).toHaveBeenCalledWith('task-1', {
        revision: 0,
        scene: {
          elements: [{ id: 'rect-1', type: 'rectangle', version: 1 }],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        },
      });
    });
  });
});
