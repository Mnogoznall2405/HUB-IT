import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActEmailSummaryChips from './UploadActEmailSummaryChips';

describe('UploadActEmailSummaryChips', () => {
  it('renders nothing while there are no send results', () => {
    const { container } = render(<UploadActEmailSummaryChips summary={{ mode: '', successCount: 0, failedCount: 0 }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders automatic send counters', () => {
    render(<UploadActEmailSummaryChips summary={{ mode: 'auto', successCount: 2, failedCount: 1 }} />);

    expect(screen.getByText('Отправлено: 2')).toBeInTheDocument();
    expect(screen.getByText('Ошибок: 1')).toBeInTheDocument();
    expect(screen.getByText('Автоотправка')).toBeInTheDocument();
  });

  it('renders manual send mode by default', () => {
    render(<UploadActEmailSummaryChips summary={{ mode: 'selected', successCount: 1, failedCount: 0 }} />);

    expect(screen.getByText('Ручная отправка')).toBeInTheDocument();
  });
});
