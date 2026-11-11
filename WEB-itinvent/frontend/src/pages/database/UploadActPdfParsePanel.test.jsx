import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActPdfParsePanel from './UploadActPdfParsePanel';

describe('UploadActPdfParsePanel', () => {
  it('disables parse actions until a file is selected', () => {
    render(<UploadActPdfParsePanel />);

    expect(screen.getByText('1. Выбор и распознавание PDF')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Распознать акт' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Заполнить вручную (без API)' })).toBeDisabled();
  });

  it('calls automatic and manual parse callbacks with mode flag', () => {
    const onParse = vi.fn();

    render(<UploadActPdfParsePanel file={{ name: 'act.pdf' }} onParse={onParse} />);

    fireEvent.click(screen.getByRole('button', { name: 'Распознать акт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Заполнить вручную (без API)' }));

    expect(onParse).toHaveBeenNthCalledWith(1, false);
    expect(onParse).toHaveBeenNthCalledWith(2, true);
  });

  it('forwards file input changes and shows parsing labels', () => {
    const onFileSelect = vi.fn();
    const { container } = render(
      <UploadActPdfParsePanel file={{ name: 'act.pdf' }} parsing onFileSelect={onFileSelect} />
    );

    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'act.pdf', { type: 'application/pdf' })] },
    });

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Распознавание/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Подготовка/ })).toBeDisabled();
  });
});
