import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActEmailStatusList, { getUploadActEmailStatusMeta } from './UploadActEmailStatusList';

describe('UploadActEmailStatusList', () => {
  it('maps backend recipient statuses to display labels', () => {
    expect(getUploadActEmailStatusMeta('sent')).toEqual({ color: 'success', label: 'Отправлено' });
    expect(getUploadActEmailStatusMeta('missing_email')).toEqual({ color: 'warning', label: 'Нет email' });
    expect(getUploadActEmailStatusMeta('not_found')).toEqual({ color: 'warning', label: 'Не найден' });
    expect(getUploadActEmailStatusMeta('smtp_error')).toEqual({ color: 'error', label: 'Ошибка' });
  });

  it('renders recipient delivery statuses', () => {
    render(
      <UploadActEmailStatusList
        recipients={[
          { owner_no: 1, employee_name: 'Иванов И.И.', email: 'ivanov@example.test', status: 'sent' },
          { owner_no: 2, employee_name: 'Петров П.П.', detail: 'email не заполнен', status: 'missing_email' },
        ]}
      />
    );

    expect(screen.getByText('Статусы отправки')).toBeInTheDocument();
    expect(screen.getByText('Иванов И.И.')).toBeInTheDocument();
    expect(screen.getByText('ivanov@example.test')).toBeInTheDocument();
    expect(screen.getByText('Петров П.П.')).toBeInTheDocument();
    expect(screen.getByText('email не заполнен')).toBeInTheDocument();
    expect(screen.getByText('Отправлено')).toBeInTheDocument();
    expect(screen.getByText('Нет email')).toBeInTheDocument();
  });
});
