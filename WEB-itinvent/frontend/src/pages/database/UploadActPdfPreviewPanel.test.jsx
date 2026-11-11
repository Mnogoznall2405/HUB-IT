import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActPdfPreviewPanel from './UploadActPdfPreviewPanel';

describe('UploadActPdfPreviewPanel', () => {
  it('asks to choose a PDF when there is no file', () => {
    render(<UploadActPdfPreviewPanel />);

    expect(screen.getByText('Предпросмотр PDF')).toBeInTheDocument();
    expect(screen.getByText(/Выберите PDF-файл акта/)).toBeInTheDocument();
  });

  it('renders preview iframe and open action', () => {
    const onOpenPreview = vi.fn();

    render(
      <UploadActPdfPreviewPanel
        file={{ name: 'act.pdf' }}
        previewUrl="blob:act-preview"
        onOpenPreview={onOpenPreview}
      />
    );

    expect(screen.getByTitle('Предпросмотр подписанного акта')).toHaveAttribute('src', 'blob:act-preview');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть отдельно' }));
    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });

  it('renders preview error instead of iframe', () => {
    render(
      <UploadActPdfPreviewPanel
        file={{ name: 'act.pdf' }}
        previewUrl="blob:act-preview"
        previewError="Не удалось открыть PDF"
      />
    );

    expect(screen.getByText('Не удалось открыть PDF')).toBeInTheDocument();
    expect(screen.queryByTitle('Предпросмотр подписанного акта')).not.toBeInTheDocument();
  });
});
