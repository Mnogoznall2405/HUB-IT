import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailAttachmentHero from './MailAttachmentHero';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

const buildAttachment = (index, ext = 'pdf') => ({
  id: `att-${index}`,
  name: `file-${index}.${ext}`,
  size: 1024 * (index + 1),
  content_type: ext === 'pdf' ? 'application/pdf' : ext === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'image/png',
});

describe('MailAttachmentHero', () => {
  it('renders hero cards only for one or two attachments', () => {
    renderWithTheme(
      <MailAttachmentHero
        attachments={[buildAttachment(0), buildAttachment(1, 'png')]}
        formatFileSize={(value) => `${value} B`}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mail-attachment-hero-item-0')).toBeVisible();
    expect(screen.getByTestId('mail-attachment-hero-item-1')).toBeVisible();
    expect(screen.queryByTestId('mail-attachment-compact-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mail-attachment-summary-row')).not.toBeInTheDocument();
  });

  it('renders yandex-style compact cards for three attachments', () => {
    const onOpen = vi.fn();
    renderWithTheme(
      <MailAttachmentHero
        attachments={[buildAttachment(0), buildAttachment(1), buildAttachment(2, 'docx')]}
        attachmentTotalSize="12 KB"
        formatFileSize={(value) => `${value} B`}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByTestId('mail-attachment-compact-strip')).toBeVisible();
    expect(screen.getAllByTestId(/^mail-attachment-compact-card-/)).toHaveLength(3);
    expect(screen.getByTestId('mail-attachment-summary-row')).toHaveTextContent('3 файла, 12 KB');
    expect(screen.queryByTestId('mail-attachment-hero-item-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mail-attachment-show-all')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mail-attachment-compact-card-1'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows all compact cards in scroll and opens sheet from show-all for many attachments', () => {
    const attachments = Array.from({ length: 8 }, (_, index) => buildAttachment(index));
    renderWithTheme(
      <MailAttachmentHero
        attachments={attachments}
        attachmentTotalSize="64 KB"
        formatFileSize={(value) => `${value} B`}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId(/^mail-attachment-compact-card-/)).toHaveLength(8);
    expect(screen.queryByTestId('mail-attachment-overflow-tile')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mail-attachment-show-all'));
    expect(screen.getByTestId('mail-attachments-sheet')).toBeVisible();
    expect(screen.getAllByTestId(/^mail-attachments-sheet-item-/)).toHaveLength(8);
  });
});
