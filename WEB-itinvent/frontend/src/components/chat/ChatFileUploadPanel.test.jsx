import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatFileUploadPanel from './ChatFileUploadPanel';

const theme = createTheme({ palette: { mode: 'dark' } });
const ui = {
  accentText: '#64b5f6',
  textStrong: '#ffffff',
  textSecondary: '#94a3b8',
};

const renderPanel = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <ChatFileUploadPanel
      files={[]}
      onAdd={vi.fn()}
      onCancel={vi.fn()}
      onCaptionChange={vi.fn()}
      onOpenEmoji={vi.fn()}
      onOpenMenu={vi.fn()}
      onRemoveFile={vi.fn()}
      onSend={vi.fn()}
      onSendMediaAsFilesChange={vi.fn()}
      theme={theme}
      ui={ui}
      {...props}
    />
  </ThemeProvider>,
);

let originalCreateObjectURL;
let originalRevokeObjectURL;

beforeEach(() => {
  originalCreateObjectURL = URL.createObjectURL;
  originalRevokeObjectURL = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((file) => `blob:${file.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
  vi.restoreAllMocks();
});

describe('ChatFileUploadPanel media preview', () => {
  it('sends the caption on plain Enter and keeps Shift+Enter or IME composition as text input', () => {
    const image = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    const onSend = vi.fn();
    renderPanel({ files: [image], caption: 'Подпись', onSend });

    const caption = screen.getByRole('textbox', { name: 'Подпись' });
    fireEvent.keyDown(caption, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(caption, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(caption, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('opens the editor for a static image and marks an edited image', () => {
    const image = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    const onEditImage = vi.fn();
    renderPanel({
      files: [image],
      imageEdits: [{ edited: true, recipe: { version: 1, operations: [{ type: 'rotate', turns: 1 }] } }],
      onEditImage,
      originalModeDisabledReason: 'Сбросьте изменения, чтобы отправить оригинал.',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать photo.jpg' }));
    expect(onEditImage).toHaveBeenCalledWith(0);
    expect(screen.getByTestId('file-dialog-edited-0')).toHaveTextContent('Изменено');
    expect(screen.getByRole('checkbox', { name: 'Отправить как файл' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Сбросьте изменения');
  });

  it('does not offer the raster editor for animated GIF files', () => {
    const image = new File(['gif'], 'animation.gif', { type: 'image/gif' });
    renderPanel({ files: [image], onEditImage: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Редактировать animation.gif' })).not.toBeInTheDocument();
  });

  it('renders a large image preview and the send-as-file control', async () => {
    const image = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    const onSendMediaAsFilesChange = vi.fn();

    renderPanel({ files: [image], onSendMediaAsFilesChange });

    expect(screen.getByRole('heading', { name: 'Отправить изображение' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-media-upload-grid-1')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Отправить как файл' })).not.toBeChecked();
    expect(screen.queryByText(/редактирован/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('img', { name: 'Предпросмотр photo.jpg' })).toHaveAttribute('src', 'blob:photo.jpg'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Отправить как файл' }));
    expect(onSendMediaAsFilesChange).toHaveBeenCalledWith(true);
  });

  it.each([2, 3, 4, 5])('renders a Telegram-like grid for %s images', async (count) => {
    const files = Array.from({ length: count }, (_, index) => (
      new File([`image-${index}`], `photo-${index}.jpg`, { type: 'image/jpeg' })
    ));

    renderPanel({ files });

    expect(screen.getByRole('heading', { name: 'Отправить изображения' })).toBeInTheDocument();
    expect(screen.getByTestId(`chat-media-upload-grid-${count}`)).toBeInTheDocument();
    expect(screen.getAllByTestId(/chat-media-upload-tile-/)).toHaveLength(count);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(count));
  });

  it('shows media before document rows in a mixed selection', () => {
    const image = new File(['image'], 'photo.png', { type: 'image/png' });
    const documentFile = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });

    renderPanel({ files: [image, documentFile] });

    expect(screen.getByRole('heading', { name: 'Отправить файлы' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-media-upload-grid-1')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить photo.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить report.pdf' })).toBeInTheDocument();
  });

  it('does not autoplay videos and pauses the previous preview before playing another', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
      fireEvent.play(this);
      return Promise.resolve();
    });
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
      fireEvent.pause(this);
    });
    const first = new File(['video-1'], 'first.mp4', { type: 'video/mp4' });
    const second = new File(['video-2'], 'second.mp4', { type: 'video/mp4' });

    renderPanel({ files: [first, second] });

    const firstVideo = screen.getByLabelText('Предпросмотр видео first.mp4');
    const secondVideo = screen.getByLabelText('Предпросмотр видео second.mp4');
    expect(firstVideo).not.toHaveAttribute('autoplay');
    expect(secondVideo).not.toHaveAttribute('autoplay');

    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести видео first.mp4' }));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести видео second.mp4' }));

    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(2));
    expect(pauseSpy).toHaveBeenCalledWith();
  });

  it('revokes local preview URLs when files are replaced and on unmount', async () => {
    const first = new File(['image-1'], 'first.png', { type: 'image/png' });
    const second = new File(['image-2'], 'second.png', { type: 'image/png' });
    const { rerender, unmount } = renderPanel({ files: [first] });

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(first));
    rerender(
      <ThemeProvider theme={theme}>
        <ChatFileUploadPanel files={[second]} theme={theme} ui={ui} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.png'));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second.png');
  });
});
