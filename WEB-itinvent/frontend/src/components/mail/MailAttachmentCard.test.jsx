import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MailAttachmentCard from './MailAttachmentCard';

describe('MailAttachmentCard', () => {
  it('opens attachment preview from the card body', () => {
    const onOpen = vi.fn();
    const onDownload = vi.fn();

    render(
      <MailAttachmentCard
        attachment={{
          name: '08.04.2026 Kozlovskiy.xlsx',
          size: 16 * 1024,
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          downloadable: true,
        }}
        formatFileSize={(value) => `${Math.round(Number(value || 0) / 1024)} KB`}
        onOpen={onOpen}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByText(/08\.04\.2026 Kozlovskiy\.xlsx/i).closest('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('downloads from the file right-click menu without opening preview', async () => {
    const onOpen = vi.fn();
    const onDownload = vi.fn();
    render(
      <MailAttachmentCard
        attachment={{ name: 'report.pdf', downloadable: true }}
        onOpen={onOpen}
        onDownload={onDownload}
      />,
    );

    fireEvent.contextMenu(screen.getByText('report.pdf'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Скачать' }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
