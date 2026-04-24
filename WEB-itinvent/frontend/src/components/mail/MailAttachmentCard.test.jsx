import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MailAttachmentCard from './MailAttachmentCard';

describe('MailAttachmentCard', () => {
  it('opens attachment from the card body and exposes open/download in the action menu', () => {
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
      />
    );

    fireEvent.click(screen.getByText(/08\.04\.2026 kozlovskiy\.xlsx/i).closest('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /действия для вложения/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /открыть/i }));
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /действия для вложения/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /скачать/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/16 KB/i)).toBeTruthy();
  });
});
