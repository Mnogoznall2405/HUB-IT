import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  normalizeTaskDetailTab,
  TaskContextSidebar,
  TaskDetailHeader,
  TaskPreviewDrawer,
} from './TaskUi';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const sampleTask = {
  id: 'task-transfer-1',
  title: 'Загрузить подписанный акт перемещения',
  status: 'in_progress',
  priority: 'high',
  assignee_full_name: 'Исполнитель И.И.',
  controller_full_name: 'Контролер К.К.',
  due_at: '2026-03-21T10:00:00Z',
  updated_at: '2026-03-21T09:30:00Z',
  description: '**Подписанный PDF** должен быть загружен в карточку.\n\n- Проверить INV_NO\n- Сверить дату акта',
  latest_report: {
    id: 'report-1',
    file_name: 'report.pdf',
    uploaded_at: '2026-03-21T09:15:00Z',
    uploaded_by_username: 'operator',
    comment: 'Отчёт обновлён.\n\n1. Подготовить PDF\n2. Проверить подписи',
  },
};

describe('TaskUi helpers', () => {
  it('normalizes invalid task detail tabs to comments', () => {
    expect(normalizeTaskDetailTab('history')).toBe('history');
    expect(normalizeTaskDetailTab('FILES')).toBe('files');
    expect(normalizeTaskDetailTab('unexpected')).toBe('comments');
    expect(normalizeTaskDetailTab('')).toBe('comments');
  });

  it('renders compact preview drawer without full activity feed', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskPreviewDrawer
          open
          onClose={vi.fn()}
          loading={false}
          task={sampleTask}
          ui={ui}
          theme={theme}
          paperSx={{}}
          statusMeta={{ label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.16)' }}
          priorityMeta={{ value: 'high', label: 'Высокий', dotColor: '#d97706' }}
          transferLabel="Осталось актов: 1"
          isTransferReminder
          canOpenTransferActUpload
          onOpenTransferActReminder={vi.fn()}
          onOpenInTasks={vi.fn()}
          onDownloadReport={vi.fn()}
          formatDateTime={(value) => value || '-'}
          latestCommentPreview="Козловский М.Е.: Не забудьте загрузить подписанный PDF."
        />
      </ThemeProvider>
    );

    expect(screen.getByText('Открыть в задачах')).toBeInTheDocument();
    expect(screen.getByText('Загрузить подписанный акт')).toBeInTheDocument();
    expect(screen.getByText('Последний комментарий')).toBeInTheDocument();
    expect(screen.getByText('Что делать сейчас')).toBeInTheDocument();
    expect(screen.getByText('Проверить INV_NO')).toBeInTheDocument();
    expect(screen.getByText('Подготовить PDF')).toBeInTheDocument();
    expect(screen.queryByText('История статусов')).not.toBeInTheDocument();
    expect(screen.queryByText('Новый комментарий')).not.toBeInTheDocument();
  });

  it('renders mobile preview drawer with compact header actions', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskPreviewDrawer
          open
          onClose={vi.fn()}
          loading={false}
          task={sampleTask}
          mobile
          ui={ui}
          theme={theme}
          paperSx={{}}
          statusMeta={{ label: 'Р’ СЂР°Р±РѕС‚Рµ', color: '#d97706', bg: 'rgba(217,119,6,0.16)' }}
          priorityMeta={{ value: 'high', label: 'Р’С‹СЃРѕРєРёР№', dotColor: '#d97706' }}
          transferLabel="РћСЃС‚Р°Р»РѕСЃСЊ Р°РєС‚РѕРІ: 1"
          isTransferReminder={false}
          canOpenTransferActUpload={false}
          onOpenTransferActReminder={vi.fn()}
          onOpenInTasks={vi.fn()}
          onDownloadReport={vi.fn()}
          formatDateTime={(value) => value || '-'}
          latestCommentPreview=""
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('task-preview-mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-preview-mobile-actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Назад к центру управления' })).toBeInTheDocument();
    expect(screen.queryByText('РћС‚РєСЂС‹С‚СЊ РІ Р·Р°РґР°С‡Р°С…')).not.toBeInTheDocument();
  });

  it('renders compact mobile detail header with overflow actions', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskDetailHeader
          task={sampleTask}
          statusMeta={{ label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.16)' }}
          priorityMeta={{ value: 'high', label: 'Высокий', dotColor: '#d97706' }}
          transferLabel="Осталось актов: 1"
          isTransferReminder={false}
          onBack={vi.fn()}
          onCopyLink={vi.fn()}
          mobile
          actionMenuItems={[{ key: 'copy', label: 'Копировать ссылку' }]}
          onActionMenuSelect={vi.fn()}
          ui={ui}
          theme={theme}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('task-detail-mobile-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-mobile-actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Назад/i })).toBeInTheDocument();
  });

  it('renders mobile context sidebar as compact sections', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskContextSidebar
          task={sampleTask}
          ui={ui}
          theme={theme}
          statusMeta={{ label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.16)' }}
          priorityMeta={{ value: 'high', label: 'Высокий', dotColor: '#d97706' }}
          transferLabel="Осталось актов: 1"
          isTransferReminder={false}
          formatDateTime={(value) => value || '-'}
          actions={<button type="button">primary</button>}
          mobile
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('task-context-mobile-context')).toBeInTheDocument();
    expect(screen.getByTestId('task-context-mobile-timeline')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Контекст задачи'));
    expect(screen.getByText('Исполнитель')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Сроки и состояние'));
    expect(screen.getByText('Срок')).toBeInTheDocument();
  });
});
