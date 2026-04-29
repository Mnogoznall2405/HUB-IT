import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailBulkActionBar from './MailBulkActionBar';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildProps(overrides = {}) {
  return {
    count: 2,
    moveTarget: '',
    moveTargets: [
      { value: 'archive', label: 'Архив' },
      { value: 'projects', label: 'Проекты' },
    ],
    loading: false,
    onMoveTargetChange: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onArchive: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe('MailBulkActionBar', () => {
  it('renders compact mobile selection header and bottom actions', () => {
    const props = buildProps({ isMobile: true });

    renderWithTheme(<MailBulkActionBar {...props} />);

    expect(screen.getByTestId('mail-mobile-bulk-header')).toBeTruthy();
    expect(screen.getByTestId('mail-mobile-bulk-bottom-bar')).toBeTruthy();
    expect(screen.getByText('Выбрано: 2')).toBeTruthy();

    fireEvent.click(screen.getByText('Прочитано'));
    fireEvent.click(screen.getByText('Не проч.'));
    fireEvent.click(screen.getByText('Архив'));
    fireEvent.click(screen.getByText('Удалить'));

    expect(props.onMarkRead).toHaveBeenCalledTimes(1);
    expect(props.onMarkUnread).toHaveBeenCalledTimes(1);
    expect(props.onArchive).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('opens mobile more sheet with move targets and clear action', () => {
    const props = buildProps({ isMobile: true });

    renderWithTheme(<MailBulkActionBar {...props} />);

    fireEvent.click(screen.getByText('Еще'));
    const moveList = screen.getByTestId('mail-mobile-bulk-move-list');
    fireEvent.click(within(moveList).getByText('Проекты'));
    expect(props.onMoveTargetChange).toHaveBeenCalledWith('projects');

    fireEvent.click(screen.getByText('Снять выбор'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('keeps selected count visible while mobile actions are loading', () => {
    renderWithTheme(<MailBulkActionBar {...buildProps({ isMobile: true, loading: true })} />);

    expect(screen.getByText('Выбрано: 2')).toBeTruthy();
    expect(screen.getByText('Выполняем...')).toBeTruthy();
    expect(screen.getByText('Прочитано')).toBeDisabled();
  });

  it('keeps the desktop bulk toolbar available', () => {
    const props = buildProps({ isMobile: false });

    renderWithTheme(<MailBulkActionBar {...props} />);

    expect(screen.queryByTestId('mail-mobile-bulk-bottom-bar')).toBeNull();
    expect(screen.getByText('Выбрано: 2')).toBeTruthy();
    fireEvent.click(screen.getByText('Снять выбор'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
