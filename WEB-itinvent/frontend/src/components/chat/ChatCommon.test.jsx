import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentCard, FileAttachment } from './ChatCommon';
import { buildAttachmentUrl } from './chatHelpers';

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
});

describe('AttachmentCard', () => {
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
