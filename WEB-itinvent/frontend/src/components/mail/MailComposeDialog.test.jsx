import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-quill', () => ({
  default: React.forwardRef(({ value, onChange, placeholder, onFocus, onBlur }, ref) => (
    <textarea
      ref={ref}
      data-testid="mock-quill"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )),
}));

import MailComposeDialog from './MailComposeDialog';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    dialogTitle: 'Новое письмо',
    composeMode: 'new',
    draftSyncState: 'idle',
    draftSavedAt: '',
    composeError: '',
    onClearComposeError: vi.fn(),
    formatFullDate: (value) => value || '',
    composeDragActive: false,
    onDragEnter: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    onFileChange: vi.fn(),
    composeToOptions: [],
    composeToLoading: false,
    composeFromOptions: [{ id: 'mb-1', label: 'Support', mailbox_email: 'support@example.com' }],
    composeFromMailboxId: 'mb-1',
    onComposeFromMailboxIdChange: vi.fn(),
    composeToValues: [],
    onComposeToValuesChange: vi.fn(),
    onComposeToSearchChange: vi.fn(),
    composeFieldErrors: {},
    composeCcValues: [],
    onComposeCcValuesChange: vi.fn(),
    composeBccValues: [],
    onComposeBccValuesChange: vi.fn(),
    composeSubject: '',
    onComposeSubjectChange: vi.fn(),
    composeBody: '<p>Hello</p>',
    onComposeBodyChange: vi.fn(),
    quotedOriginalHtml: '<blockquote><p>Older quote</p></blockquote>',
    composeSignatureHtml: '<p>--<br>Signature</p>',
    composeDraftAttachments: [],
    composeFiles: [],
    composeWarnings: [],
    onDismissComposeWarning: vi.fn(),
    onComposePasteFiles: vi.fn(),
    onSendComposeShortcut: vi.fn(),
    formatFileSize: (value) => `${value} B`,
    sumFilesSize: () => 0,
    sumAttachmentSize: () => 0,
    onRemoveDraftAttachment: vi.fn(),
    onRemoveComposeFile: vi.fn(),
    composeSending: false,
    composeUploadProgress: 0,
    onCancelComposeUpload: vi.fn(),
    onOpenSignatureEditor: vi.fn(),
    onSendCompose: vi.fn(),
    layoutMode: 'mobile',
    ...overrides,
  };
}

describe('MailComposeDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps meta collapsed by default and exposes signature inside the details disclosure', () => {
    const props = buildProps();
    renderWithTheme(<MailComposeDialog {...props} />);

    expect(screen.getByTestId('mail-compose-mobile-paper')).toBeTruthy();
    expect(screen.queryByTestId('mail-compose-subject-field')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Тема и детали/i }));

    expect(screen.getByTestId('mail-compose-subject-field')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mail-compose-open-signature'));
    expect(props.onOpenSignatureEditor).toHaveBeenCalledTimes(1);
  });

  it('focuses the editor once on open by default', () => {
    renderWithTheme(<MailComposeDialog {...buildProps()} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId('mock-quill')).toHaveFocus();
  });

  it('keeps focus in the subject field after typing instead of jumping back into the editor', () => {
    function StatefulComposeDialog() {
      const [subject, setSubject] = React.useState('');
      return (
        <ThemeProvider theme={createTheme()}>
          <MailComposeDialog
            {...buildProps({
              composeSubject: subject,
              onComposeSubjectChange: setSubject,
            })}
          />
        </ThemeProvider>
      );
    }

    render(<StatefulComposeDialog />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    fireEvent.click(screen.getByTestId('mail-compose-meta-toggle'));
    const subjectField = screen.getByTestId('mail-compose-subject-field');
    const subjectInput = within(subjectField).getByRole('textbox');

    subjectInput.focus();
    fireEvent.change(subjectInput, { target: { value: 'A' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(subjectInput).toHaveFocus();
    expect(screen.getByTestId('mock-quill')).not.toHaveFocus();
  });

  it('shows the accessory toolbar on editor focus and reveals the separated quoted original on demand', () => {
    renderWithTheme(<MailComposeDialog {...buildProps()} />);

    fireEvent.focus(screen.getByTestId('mock-quill'));
    expect(screen.getByLabelText('Форматирование')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-compose-quote-toggle'));
    const quotedOriginal = screen.getByTestId('mail-compose-quoted-original');
    expect(quotedOriginal).toBeTruthy();
    expect(within(quotedOriginal).getByText('Older quote')).toBeTruthy();
  });

  it('renders the final preview without a forced outgoing background and with signature before quoted history', () => {
    renderWithTheme(<MailComposeDialog {...buildProps()} />);

    const preview = screen.getByTestId('mail-compose-final-preview');
    const previewHtml = preview.innerHTML;

    expect(previewHtml).toContain('data-mail-outgoing="true"');
    expect(previewHtml).not.toContain('background:#ffffff');
    expect(previewHtml.indexOf('data-mail-signature="true"')).toBeGreaterThan(-1);
    expect(previewHtml.indexOf('Signature')).toBeLessThan(previewHtml.indexOf('Older quote'));
  });

  it('scopes the Office message font to the editor and outgoing preview', () => {
    renderWithTheme(<MailComposeDialog {...buildProps()} />);

    const editorShell = screen.getByTestId('mail-compose-editor-shell');
    const previewBody = screen.getByTestId('mail-compose-final-preview-body');

    expect(editorShell.getAttribute('data-mail-message-font')).toContain('Aptos');
    expect(previewBody.getAttribute('data-mail-message-font')).toContain('Aptos');
    expect(editorShell.getAttribute('data-mail-message-font')).toContain('Calibri');
  });

  it('renders the desktop inline compose layout inside the preview pane', () => {
    renderWithTheme(<MailComposeDialog {...buildProps({ layoutMode: 'desktop-inline' })} />);

    expect(screen.getByTestId('mail-compose-inline-pane')).toBeTruthy();
    expect(screen.getByTestId('mail-compose-subject-field')).toBeTruthy();
    expect(screen.getByTestId('mail-compose-attach-action')).toBeTruthy();
    expect(screen.queryByTestId('mail-compose-final-preview')).toBeNull();
  });
});
