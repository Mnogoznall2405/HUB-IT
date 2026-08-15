import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/chatDirectory', () => ({
  chatDirectoryAPI: {
    saveAttachmentToMyFiles: vi.fn(),
  },
}));

import { AttachmentCard, FileAttachment } from './ChatCommon';
import { buildAttachmentUrl } from './chatHelpers';
import { chatStickersAPI } from '../../api/chatStickers';
import { chatDirectoryAPI } from '../../api/chatDirectory';

const theme = createTheme();
const ui = {
  textSecondary: '#64748b',
  borderSoft: 'rgba(148,163,184,0.2)',
  composerInputBg: '#223140',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

describe('FileAttachment', () => {
  it('renders a telegram-style file block with a single clickable surface', () => {
    renderWithTheme(
      <FileAttachment
        fileName="financial-report-very-long-name.xlsx"
        fileSize={471552}
        fileUrl="/files/report.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        theme={theme}
        ui={ui}
      />,
    );

    const fileLink = screen.getByRole('link', { name: /Открыть файл financial-report-very-long-name\.xlsx/i });
    expect(fileLink).toHaveAttribute('href', '/files/report.xlsx');
    expect(fileLink).not.toHaveTextContent('Открыть');
    expect(fileLink).not.toHaveTextContent('Скачать');
    expect(fileLink).toHaveTextContent('XLSX');
    expect(fileLink).toHaveTextContent('XLSX • 460.5 КБ');

    const overlay = screen.getByTestId('chat-file-attachment-overlay');
    expect(overlay).toHaveStyle({ opacity: '0' });
    fireEvent.mouseEnter(fileLink);
    expect(overlay).toHaveStyle({ opacity: '1' });
  });

  it('downloads a chat document directly from its right-click menu', async () => {
    const anchorClick = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderWithTheme(
        <FileAttachment
          fileName="report.pdf"
          fileSize={4096}
          fileUrl="/files/report.pdf?inline=1"
          downloadUrl="/files/report.pdf"
          mimeType="application/pdf"
          theme={theme}
          ui={ui}
        />,
      );

      fireEvent.contextMenu(screen.getByRole('link', { name: /report\.pdf/i }), {
        clientX: 100,
        clientY: 80,
      });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Скачать' }));

      expect(anchorClick).toHaveBeenCalledTimes(1);
    } finally {
      anchorClick.mockRestore();
    }
  });

  it('renders image attachments as thumbnails and opens preview on click', () => {
    const onOpenPreview = vi.fn();

    renderWithTheme(
      <FileAttachment
        fileName="photo.png"
        fileSize={4096}
        fileUrl="/files/photo.png"
        mimeType="image/png"
        theme={theme}
        ui={ui}
        onOpenPreview={onOpenPreview}
        previewWidth={1200}
        previewHeight={900}
      />,
    );

    const imageButton = screen.getByRole('button', { name: /Открыть изображение photo\.png/i });
    fireEvent.click(imageButton);

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', '/files/photo.png');
    expect(screen.queryByText('Скачать')).not.toBeInTheDocument();
  });

  it('renders sticker attachments inline without an open-file link', () => {
    renderWithTheme(
      <FileAttachment
        fileName="sticker-pack.webp"
        fileSize={2048}
        fileUrl="/files/sticker.webp?inline=1"
        mimeType="image/webp"
        fileType="sticker"
        theme={theme}
        ui={ui}
      />,
    );

    expect(screen.getByRole('img', { name: 'Стикер' })).toHaveAttribute(
      'src',
      '/files/sticker.webp?inline=1',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('opens the sticker pack from a sticker message and adds it to the picker', async () => {
    const pack = {
      id: 'pack-1',
      short_name: 'frrl52',
      title: 'Funny pack',
      is_added: false,
      stickers: [
        {
          id: 'sticker-1',
          emoji: '🙂',
          format: 'static',
          mime_type: 'image/webp',
          file_url: '/stickers/sticker-1/file',
          preview_url: '/stickers/sticker-1/preview',
        },
      ],
    };
    const previewSpy = vi.spyOn(chatStickersAPI, 'previewPack').mockResolvedValue(pack);
    const importSpy = vi.spyOn(chatStickersAPI, 'importPack').mockResolvedValue({
      items: [{ ...pack, is_added: true }],
    });

    try {
      renderWithTheme(
        <AttachmentCard
          messageId="msg-sticker"
          attachment={{
            id: 'att-sticker',
            file_name: 'sticker-frrl52.webp',
            mime_type: 'image/webp',
            media_kind: 'sticker',
          }}
          theme={theme}
          ui={ui}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Открыть набор стикеров' }));

      await waitFor(() => expect(previewSpy).toHaveBeenCalledWith('frrl52', expect.any(Object)));
      expect(await screen.findByText('Funny pack')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Добавить набор' }));

      await waitFor(() => expect(importSpy).toHaveBeenCalledWith('frrl52'));
      expect(await screen.findByRole('button', { name: 'Набор добавлен' })).toBeDisabled();
    } finally {
      previewSpy.mockRestore();
      importSpy.mockRestore();
    }
  });

  it('autoplays animated sticker messages without a playback button', async () => {
    const previousMatchMedia = window.matchMedia;
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const { container, unmount } = renderWithTheme(
        <FileAttachment
          fileName="animated-sticker.webm"
          fileSize={4096}
          fileUrl="/files/animated-sticker.webm"
          mimeType="video/webm"
          fileType="sticker"
          theme={theme}
          ui={ui}
        />,
      );

      const video = container.querySelector('video');
      expect(video).toHaveAttribute('autoplay');
      expect(video).toHaveAttribute('loop');
      expect(video).toHaveProperty('muted', true);
      expect(screen.queryByRole('button', { name: /анимацию стикера/i })).not.toBeInTheDocument();
      await waitFor(() => expect(playSpy).toHaveBeenCalled());
      unmount();
    } finally {
      window.matchMedia = previousMatchMedia;
      playSpy.mockRestore();
      pauseSpy.mockRestore();
      loadSpy.mockRestore();
    }
  });

  it('uses the generated poster while an animated sticker is loading', () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const attachment = {
      id: 'att-sticker',
      file_name: 'animated-sticker.webm',
      mime_type: 'video/webm',
      media_kind: 'sticker',
      variant_urls: {
        poster: '/api/v1/chat/messages/msg-sticker/attachments/att-sticker/file?inline=1&variant=poster',
      },
    };

    const { container, unmount } = renderWithTheme(
      <AttachmentCard
        messageId="msg-sticker"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    expect(container.querySelector('video')).toHaveAttribute('poster', attachment.variant_urls.poster);
    unmount();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    loadSpy.mockRestore();
  });

  it('falls back to the next image URL when a thumbnail cannot be loaded', async () => {
    renderWithTheme(
      <FileAttachment
        fileName="photo.jpg"
        fileSize={4096}
        fileUrl="/broken-thumb.jpg"
        openUrl="/files/photo.jpg"
        fallbackFileUrls={['/files/photo.jpg']}
        mimeType="image/jpeg"
        theme={theme}
        ui={ui}
      />,
    );

    const image = screen.getByRole('img', { name: 'photo.jpg' });
    expect(image).toHaveAttribute('src', '/broken-thumb.jpg');

    fireEvent.error(image);

    await waitFor(() => expect(image).toHaveAttribute('src', '/files/photo.jpg'));
  });

  it('respects a smaller media max width for in-chat previews', () => {
    renderWithTheme(
      <FileAttachment
        fileName="photo.png"
        fileSize={4096}
        fileUrl="/files/photo.png"
        mimeType="image/png"
        theme={theme}
        ui={ui}
        mediaMaxWidth="220px"
      />,
    );

    expect(screen.getByRole('link')).toHaveStyle({ maxWidth: '220px' });
  });

  it('shrinks wide images by media max height in chat previews', () => {
    renderWithTheme(
      <FileAttachment
        fileName="wide-photo.png"
        fileSize={4096}
        fileUrl="/files/wide-photo.png"
        mimeType="image/png"
        theme={theme}
        ui={ui}
        previewWidth={1600}
        previewHeight={800}
        mediaMaxWidth={220}
        mediaMaxHeight={90}
      />,
    );

    expect(screen.getByRole('link')).toHaveStyle({ width: '180px', maxWidth: '220px' });
  });

  it('keeps portrait media previews from collapsing narrower than the chat minimum', () => {
    renderWithTheme(
      <FileAttachment
        fileName="portrait-photo.png"
        fileSize={4096}
        fileUrl="/files/portrait-photo.png"
        mimeType="image/png"
        theme={theme}
        ui={ui}
        previewWidth={800}
        previewHeight={1600}
        mediaMaxWidth={216}
        mediaMaxHeight={176}
        mediaMinWidth={148}
      />,
    );

    expect(screen.getByRole('link')).toHaveStyle({ width: '148px', maxWidth: '216px', minWidth: '148px' });
  });

  it('renders video attachments with a preview surface and duration badge', () => {
    renderWithTheme(
      <FileAttachment
        fileName="clip.mp4"
        fileSize={1024 * 1024}
        fileUrl="/files/clip.mp4"
        mimeType="video/mp4"
        theme={theme}
        ui={ui}
        durationSeconds={95}
      />,
    );

    const videoLink = screen.getByRole('link', { name: /Открыть видео clip\.mp4/i });
    expect(videoLink).toHaveAttribute('href', '/files/clip.mp4');
    expect(screen.getByText('1:35')).toBeInTheDocument();
  });

  it('renders voice attachments as audio and exposes a fallback link on playback errors', async () => {
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new Error('playback blocked'));

    try {
      const { container } = renderWithTheme(
        <FileAttachment
          fileName="voice_123.webm"
          fileSize={4096}
          fileUrl="/files/voice_123.webm"
          openUrl="/files/voice_123.webm"
          mimeType="audio/webm"
          fileType="audio"
          theme={theme}
          ui={ui}
          durationSeconds={7}
        />,
      );

      const audio = container.querySelector('audio');
      expect(audio).toBeTruthy();
      expect(audio).toHaveAttribute('src', '/files/voice_123.webm');
      expect(screen.getByText('0:07')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(container.querySelector('a[href="/files/voice_123.webm"]')).toBeTruthy());
    } finally {
      playSpy.mockRestore();
    }
  });
});

describe('AttachmentCard', () => {
  it('saves an AI-generated attachment to My Files only after an explicit click', async () => {
    chatDirectoryAPI.saveAttachmentToMyFiles.mockResolvedValue({ id: 'my-file-1' });
    renderWithTheme(
      <AttachmentCard
        messageId="message-ai-1"
        attachment={{ id: 'attachment-ai-1', file_name: 'report.xlsx', mime_type: 'application/octet-stream' }}
        theme={theme}
        ui={ui}
        canSaveToMyFiles
      />,
    );

    expect(chatDirectoryAPI.saveAttachmentToMyFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в Мои файлы' }));

    await waitFor(() => expect(chatDirectoryAPI.saveAttachmentToMyFiles).toHaveBeenCalledWith('message-ai-1', 'attachment-ai-1'));
    expect(await screen.findByRole('button', { name: 'Файл отправлен на проверку и сохранение в Мои файлы' })).toBeDisabled();
  });

  it('maps chat attachment payloads to the telegram-style attachment component', () => {
    const onOpenPreview = vi.fn();
    const attachment = {
      id: 'att-1',
      file_name: 'photo.png',
      mime_type: 'image/png',
      file_size: 4096,
      width: 1200,
      height: 900,
      variant_urls: {
        preview: '/api/v1/chat/messages/msg-1/attachments/att-1/file?inline=1&variant=preview',
      },
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-1"
        attachment={attachment}
        theme={theme}
        ui={ui}
        onOpenPreview={onOpenPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Открыть изображение photo\.png/i }));
    expect(onOpenPreview).toHaveBeenCalledWith('msg-1', attachment);
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', attachment.variant_urls.preview);
  });

  it('renders image attachments through the inline original URL when preview variants are absent', () => {
    const attachment = {
      id: 'att-inline',
      file_name: 'sent-photo.jpg',
      mime_type: 'image/jpeg',
      file_size: 4096,
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-inline"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    expect(screen.getByRole('img', { name: 'sent-photo.jpg' }))
      .toHaveAttribute('src', buildAttachmentUrl('msg-inline', 'att-inline', { inline: true }));
  });

  it('falls back from a broken generated variant to the inline original image', async () => {
    const attachment = {
      id: 'att-fallback',
      file_name: 'mobile-photo.jpg',
      mime_type: 'image/jpeg',
      file_size: 4096,
      variant_urls: {
        thumb: '/api/v1/chat/messages/msg-fallback/attachments/att-fallback/file?inline=1&variant=thumb',
      },
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-fallback"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    const image = screen.getByRole('img', { name: 'mobile-photo.jpg' });
    expect(image).toHaveAttribute('src', attachment.variant_urls.thumb);

    fireEvent.error(image);

    await waitFor(() => expect(image)
      .toHaveAttribute('src', buildAttachmentUrl('msg-fallback', 'att-fallback', { inline: true })));
  });

  it('treats image file extensions as image attachments when mime type is generic', () => {
    const attachment = {
      id: 'att-generic',
      file_name: 'camera-upload.jpg',
      mime_type: 'application/octet-stream',
      file_size: 4096,
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-generic"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    expect(screen.getByRole('img', { name: 'camera-upload.jpg' }))
      .toHaveAttribute('src', buildAttachmentUrl('msg-generic', 'att-generic', { inline: true }));
  });

  it('routes video attachments into the unified preview flow when available', () => {
    const onOpenPreview = vi.fn();
    const attachment = {
      id: 'att-3',
      file_name: 'clip.mp4',
      mime_type: 'video/mp4',
      file_size: 8192,
      variant_urls: {
        poster: '/api/v1/chat/messages/msg-3/attachments/att-3/file?inline=1&variant=poster',
      },
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-3"
        attachment={attachment}
        theme={theme}
        ui={ui}
        onOpenPreview={onOpenPreview}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onOpenPreview).toHaveBeenCalledWith('msg-3', attachment);
    expect(screen.getByRole('img', { name: 'clip.mp4' })).toHaveAttribute('src', attachment.variant_urls.poster);
  });

  it('renders explicit audio attachments through the inline original URL', () => {
    const attachment = {
      id: 'att-voice',
      kind: 'audio',
      media_kind: 'audio',
      file_name: 'voice_456.webm',
      mime_type: 'application/octet-stream',
      file_size: 4096,
      duration_seconds: 12,
    };

    const { container } = renderWithTheme(
      <AttachmentCard
        messageId="msg-voice"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio).toHaveAttribute('src', buildAttachmentUrl('msg-voice', 'att-voice', { inline: true }));
    expect(screen.getByText('0:12')).toBeInTheDocument();
  });

  it('keeps non-image attachments as a single openable link', () => {
    const attachment = {
      id: 'att-2',
      file_name: 'doc.pdf',
      mime_type: 'application/pdf',
      file_size: 8192,
    };

    renderWithTheme(
      <AttachmentCard
        messageId="msg-2"
        attachment={attachment}
        theme={theme}
        ui={ui}
      />,
    );

    const fileLink = screen.getByRole('link', { name: /Открыть файл doc\.pdf/i });
    expect(fileLink).toHaveAttribute('href', buildAttachmentUrl('msg-2', 'att-2', { inline: true }));
    expect(fileLink).toHaveTextContent('PDF');
    expect(screen.queryByText('Скачать')).not.toBeInTheDocument();
  });
});
