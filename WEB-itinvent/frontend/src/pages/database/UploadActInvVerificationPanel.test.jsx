import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActInvVerificationPanel from './UploadActInvVerificationPanel';

describe('UploadActInvVerificationPanel', () => {
  it('renders recognized, final and diff inventory numbers', () => {
    render(
      <UploadActInvVerificationPanel
        verification={{
          severity: 'warning',
          headline: 'Списки отличаются.',
          recognizedInvNos: ['1001', '1002'],
          finalInvNos: ['1002', '1003'],
          onlyRecognizedInvNos: ['1001'],
          onlyFinalInvNos: ['1003'],
        }}
      />
    );

    expect(screen.getByText('Проверка инвентарных номеров')).toBeInTheDocument();
    expect(screen.getByText('Списки отличаются.')).toBeInTheDocument();
    expect(screen.getByText('Найдено API')).toBeInTheDocument();
    expect(screen.getByText('Будет записано в акт')).toBeInTheDocument();
    expect(screen.getByText('Не попадут в запись')).toBeInTheDocument();
    expect(screen.getByText('Добавлены или изменены вручную')).toBeInTheDocument();
    expect(screen.getAllByText('1001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1003').length).toBeGreaterThan(0);
  });

  it('notifies parent when verification checkbox changes', () => {
    const onVerifiedChange = vi.fn();

    render(
      <UploadActInvVerificationPanel
        verification={{
          severity: 'success',
          headline: 'OK',
          recognizedInvNos: ['1001'],
          finalInvNos: ['1001'],
          onlyRecognizedInvNos: [],
          onlyFinalInvNos: [],
        }}
        onVerifiedChange={onVerifiedChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Я проверил инвентарные номера по PDF перед записью акта'));

    expect(onVerifiedChange).toHaveBeenCalledWith(true);
  });
});
