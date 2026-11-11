import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';
import TransferActionContent, {
  formatTransferOwnerOptionLabel,
  getTransferResultSeverity,
  isSameTransferOwnerOption,
  isTransferEmailSendDisabled,
} from './TransferActionContent';

const renderTransferActionContent = (props = {}) => {
  const theme = createTheme();
  const ui = buildOfficeUiTokens(theme);
  const actions = {
    onModeChange: vi.fn(),
    onEmployeeInputChange: vi.fn(),
    onEmployeeChange: vi.fn(),
    onCreateEmployee: vi.fn(),
    onDepartmentChange: vi.fn(),
    onBranchChange: vi.fn(),
    onLocationChange: vi.fn(),
    onRefreshJob: vi.fn(),
    onOpenReminderTask: vi.fn(),
    onOpenUploadReminder: vi.fn(),
    onDownloadAct: vi.fn(),
    onEmailModeChange: vi.fn(),
    onManualEmailChange: vi.fn(),
    onRecipientInputChange: vi.fn(),
    onRecipientChange: vi.fn(),
    onSendEmail: vi.fn(),
    onRetryFailed: vi.fn(),
    ...(props.actions || {}),
  };

  render(
    <ThemeProvider theme={theme}>
      <TransferActionContent
        canDatabaseWrite
        ui={ui}
        theme={theme}
        branchOptions={[
          { branch_no: '10', branch_name: 'Main branch' },
        ]}
        locationOptions={[
          { loc_no: '20', loc_name: 'Office 20', search_blob: 'office 20 20' },
        ]}
        sourceDefaults={{
          branch_name: 'Old branch',
          location_name: 'Old location',
          mixed_branch: true,
          mixed_location: false,
        }}
        transfer={{
          mode: TRANSFER_OPERATION_MOVE,
          result: null,
          employeeInput: '',
          employeeInputTrimmed: '',
          employeeOptions: [],
          employeeLoading: false,
          selectedEmployeeOption: null,
          usesManualEmployee: false,
          newEmployee: '',
          department: '',
          departmentOptions: ['IT'],
          departmentLoading: false,
          branchNo: '',
          locationNo: '',
          locationsLoading: false,
          ...(props.transfer || {}),
        }}
        email={{
          mode: 'old',
          manualEmail: '',
          recipientInput: '',
          recipientOptions: [],
          recipient: null,
          recipientLoading: false,
          loading: false,
          status: '',
          error: '',
          ...(props.email || {}),
        }}
        actions={actions}
        {...props.componentProps}
      />
    </ThemeProvider>
  );
  return { actions };
};

describe('TransferActionContent helpers', () => {
  it('formats and compares owner options', () => {
    expect(formatTransferOwnerOptionLabel({
      OWNER_DISPLAY_NAME: 'Ivan Petrov',
      OWNER_DEPT: 'IT',
    })).toBe('Ivan Petrov (IT)');
    expect(formatTransferOwnerOptionLabel({ __create: true }, 'Add Ivan')).toBe('Add Ivan');
    expect(isSameTransferOwnerOption({ OWNER_NO: '7' }, { owner_no: 7 })).toBe(true);
    expect(isSameTransferOwnerOption({ OWNER_NO: '7' }, { owner_no: 8 })).toBe(false);
  });

  it('derives transfer result severity and email disabled state', () => {
    expect(getTransferResultSeverity({ result: { job_status: 'failed' } })).toBe('error');
    expect(getTransferResultSeverity({ result: { job_status: 'queued' } })).toBe('info');
    expect(getTransferResultSeverity({ result: { failed_count: 1 } })).toBe('warning');
    expect(getTransferResultSeverity({ result: { failed_count: 0 } })).toBe('success');

    expect(isTransferEmailSendDisabled({
      canDatabaseWrite: true,
      emailLoading: false,
      jobPolling: false,
      result: { job_status: 'done', acts: [{ act_id: 1 }] },
    })).toBe(false);
    expect(isTransferEmailSendDisabled({
      canDatabaseWrite: true,
      emailLoading: false,
      jobPolling: false,
      result: { job_status: 'queued', acts: [{ act_id: 1 }] },
    })).toBe(true);
  });
});

describe('TransferActionContent', () => {
  it('renders move mode defaults and mixed-location warning', () => {
    renderTransferActionContent();

    expect(screen.getByRole('combobox', { name: 'Действие' })).toHaveTextContent('Перемещение с актом');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Действие' }));
    expect(screen.getByRole('option', { name: 'Перемещение' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Перемещение с актом' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Акт без перемещения' })).toBeInTheDocument();
    expect(screen.getByText('Текущие значения по умолчанию: Old branch / Old location')).toBeInTheDocument();
    expect(screen.getByText(/Выбраны позиции из разных филиалов/)).toBeInTheDocument();
  });

  it('renders location-only mode without employee, act, or email controls', () => {
    renderTransferActionContent({
      transfer: {
        mode: TRANSFER_OPERATION_LOCATION_ONLY,
      },
    });

    expect(screen.getByText(/Будут изменены только филиал и местоположение/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Филиал назначения' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Местоположение назначения' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Новый сотрудник')).not.toBeInTheDocument();
    expect(screen.queryByText('Отправка акта по email')).not.toBeInTheDocument();
  });

  it('renders location-only result without email actions', () => {
    renderTransferActionContent({
      transfer: {
        mode: TRANSFER_OPERATION_LOCATION_ONLY,
        result: {
          success_count: 1,
          failed_count: 0,
          transferred: [{ inv_no: '1001' }],
          failed: [],
          acts: [],
        },
      },
    });

    expect(screen.getByText('Перемещено: 1, ошибок: 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отправить акт' })).not.toBeInTheDocument();
  });

  it('retries only the server-confirmed failed inventory numbers', () => {
    const { actions } = renderTransferActionContent({
      transfer: {
        result: {
          success_count: 1,
          failed_count: 1,
          transferred: [{ inv_no: '1001' }],
          failed: [{ inv_no: '1002', error: 'blocked' }],
          retry_inv_nos: ['1001', '1002'],
          acts: [],
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Повторить только неуспешные/ }));

    expect(actions.onRetryFailed).toHaveBeenCalledWith(['1002']);
  });

  it('emits employee input changes without touching APIs', () => {
    const { actions } = renderTransferActionContent();

    fireEvent.change(screen.getByLabelText('Новый сотрудник'), {
      target: { value: 'Ivan Petrov' },
    });

    expect(actions.onEmployeeInputChange).toHaveBeenCalledWith('Ivan Petrov');
  });

  it('renders pending result and requests job refresh', () => {
    const { actions } = renderTransferActionContent({
      transfer: {
        result: {
          job_id: 'job-1',
          job_status: 'queued',
          job_status_text: 'Job is queued',
          success_count: 0,
          failed_count: 0,
          acts: [],
        },
      },
    });

    expect(screen.getByText('Job is queued')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }));

    expect(actions.onRefreshJob).toHaveBeenCalledWith('job-1', { refreshEquipment: true });
  });

  it('renders act-only result actions and sends email when ready', () => {
    const act = {
      act_id: 5,
      old_employee: 'Old owner',
      new_employee: 'New owner',
      equipment_count: 2,
    };
    const { actions } = renderTransferActionContent({
      transfer: {
        mode: TRANSFER_OPERATION_ACT_ONLY,
        result: {
          job_status: 'done',
          success_count: 2,
          failed_count: 0,
          acts: [act],
        },
      },
    });

    expect(screen.getByText('Old owner → New owner (2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить акт' }));

    expect(actions.onDownloadAct).toHaveBeenCalledWith(act);
    expect(actions.onSendEmail).toHaveBeenCalledTimes(1);
  });

  it('disables email send while a transfer job is still pending', () => {
    renderTransferActionContent({
      transfer: {
        result: {
          job_status: 'processing',
          success_count: 0,
          failed_count: 0,
          acts: [{ act_id: 1 }],
        },
      },
    });

    expect(screen.getByRole('button', { name: 'Отправить акт' })).toBeDisabled();
  });
});
