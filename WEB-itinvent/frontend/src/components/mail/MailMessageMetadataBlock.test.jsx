import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import MailMessageMetadataBlock from './MailMessageMetadataBlock';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailMessageMetadataBlock', () => {
  it('renders compact rows and opens the details sheet', () => {
    renderWithTheme(
      <MailMessageMetadataBlock
        message={{
          sender_email: 'boss@example.com',
          sender_display: 'Boss Name',
          received_at: '2026-03-31T10:00:00Z',
          to_people: [
            { name: 'User One', email: 'one@example.com', display: 'User One' },
            { name: 'User Two', email: 'two@example.com', display: 'User Two' },
            { name: 'User Three', email: 'three@example.com', display: 'User Three' },
            { name: 'User Four', email: 'four@example.com', display: 'User Four' },
          ],
        }}
        formatFullDate={() => '31.03.2026 10:00'}
      />,
    );

    expect(screen.getByTestId('mail-message-metadata-block')).toBeVisible();
    expect(screen.getByTestId('mail-message-metadata-from')).toBeVisible();
    expect(screen.getByTestId('mail-message-metadata-sent')).toBeVisible();
    expect(screen.getByTestId('mail-message-metadata-to')).toBeVisible();
    expect(screen.getByTestId('mail-message-metadata-from')).toHaveTextContent('От');
    expect(screen.getByTestId('mail-message-metadata-sent')).toHaveTextContent('Отправлено');
    expect(screen.getByTestId('mail-message-metadata-to')).toHaveTextContent('Кому');
    expect(screen.getByTestId('mail-message-metadata-from')).toHaveTextContent(/Boss Name/i);
    expect(screen.getByTestId('mail-message-metadata-sent')).toHaveTextContent('31.03.2026 10:00');
    expect(screen.getByTestId('mail-message-metadata-to')).toHaveTextContent(/User One/i);

    fireEvent.click(screen.getByTestId('mail-message-metadata-to'));
    expect(screen.getByTestId('mail-message-metadata-sheet')).toBeVisible();
    expect(screen.getByText('Детали письма')).toBeVisible();
  });
});
