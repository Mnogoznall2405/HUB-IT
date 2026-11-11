import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActCommitResultAlerts from './UploadActCommitResultAlerts';

describe('UploadActCommitResultAlerts', () => {
  it('renders nothing when there is no commit result', () => {
    const { container } = render(<UploadActCommitResultAlerts />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders saved act numbers and partial reminder status', () => {
    render(
      <UploadActCommitResultAlerts
        result={{
          doc_no: 11,
          file_no: 22,
          reminder_status: 'matched_partial',
          reminder_pending_groups: 3,
        }}
      />
    );

    expect(screen.getByText('Акт сохранён в базе: DOC_NO 11, FILE_NO 22.')).toBeInTheDocument();
    expect(screen.getByText(/Осталось загрузить актов: 3/)).toBeInTheDocument();
  });

  it('renders completed reminder status and warning', () => {
    render(
      <UploadActCommitResultAlerts
        result={{
          doc_no: 11,
          file_no: 22,
          reminder_status: 'completed',
          reminder_warning: 'Reminder уже был закрыт.',
        }}
      />
    );

    expect(screen.getByText('Все подписанные акты загружены. Reminder-задача закрыта автоматически.')).toBeInTheDocument();
    expect(screen.getByText('Reminder уже был закрыт.')).toBeInTheDocument();
  });
});
