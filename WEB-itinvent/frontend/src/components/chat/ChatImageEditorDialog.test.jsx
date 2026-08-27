import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatImageEditorDialog from './ChatImageEditorDialog';
import {
  exportChatImageEditFile,
  loadChatImageSource,
  renderChatImageRecipeToCanvas,
} from './chatImageEditor';

vi.mock('./chatImageEditor', async () => {
  const actual = await vi.importActual('./chatImageEditor');
  return {
    ...actual,
    loadChatImageSource: vi.fn(),
    renderChatImageRecipeToCanvas: vi.fn(),
    exportChatImageEditFile: vi.fn(),
  };
});

const theme = createTheme({ palette: { mode: 'dark' } });

const renderEditor = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <ChatImageEditorDialog
      file={new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })}
      initialRecipe={{ version: 1, operations: [] }}
      onApply={vi.fn()}
      onClose={vi.fn()}
      open
      {...props}
    />
  </ThemeProvider>,
);

describe('ChatImageEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChatImageSource.mockResolvedValue({ naturalWidth: 120, naturalHeight: 80 });
    renderChatImageRecipeToCanvas.mockReturnValue({ width: 120, height: 80 });
    exportChatImageEditFile.mockResolvedValue(new File(['edited'], 'photo-edited.jpg', { type: 'image/jpeg' }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    });
  });

  it('applies a rotation and returns the edited file with its recipe', async () => {
    const onApply = vi.fn();
    renderEditor({ onApply });

    await waitFor(() => expect(loadChatImageSource).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Повернуть на 90 градусов' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ name: 'photo-edited.jpg' }),
      reset: false,
      recipe: expect.objectContaining({
        operations: [expect.objectContaining({ type: 'rotate', turns: 1 })],
      }),
    })));
  });

  it('contains a tall photo and keeps the toolbar free of horizontal scrolling', async () => {
    loadChatImageSource.mockResolvedValue({ naturalWidth: 800, naturalHeight: 1200 });
    renderChatImageRecipeToCanvas.mockReturnValue({ width: 640, height: 960 });

    renderEditor();

    await waitFor(() => expect(loadChatImageSource).toHaveBeenCalledTimes(1));
    const canvas = document.querySelector('canvas');
    expect(canvas).toHaveAttribute('width', '640');
    expect(canvas).toHaveAttribute('height', '960');
    expect(canvas).toHaveStyle({
      position: 'absolute',
      inset: '0',
      margin: 'auto',
      maxWidth: '100%',
      maxHeight: '100%',
    });

    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
    expect(toolbar).not.toHaveStyle({ overflowX: 'auto' });
    expect(toolbar.querySelectorAll('[role="group"]')).toHaveLength(2);
  });

  it('asks for confirmation before discarding unsaved changes', async () => {
    const onClose = vi.fn();
    renderEditor({ onClose });

    await waitFor(() => expect(loadChatImageSource).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Повернуть на 90 градусов' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть редактор' }));

    expect(screen.getByRole('heading', { name: 'Не сохранять изменения?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить редактирование' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
