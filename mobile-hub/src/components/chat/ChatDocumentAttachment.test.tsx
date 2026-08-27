import { fireEvent, render } from '@testing-library/react-native';
import { ChatDocumentAttachment, formatChatFileSize, getChatFileExtension } from './ChatDocumentAttachment';

describe('ChatDocumentAttachment', () => {
  it('renders a Telegram-like file row and keeps open and more actions separate', async () => {
    const onOpen = jest.fn();
    const onMore = jest.fn();
    const view = await render(
      <ChatDocumentAttachment
        attachment={{
          id: 'attachment-1',
          kind: 'file',
          file_name: 'quarterly-report.pdf',
          mime_type: 'application/pdf',
          file_size: 1572864,
        }}
        width={260}
        onOpen={onOpen}
        onMore={onMore}
      />,
    );

    expect(view.getByText('PDF')).toBeTruthy();
    expect(view.getByText('quarterly-report.pdf')).toBeTruthy();
    expect(view.getByText('PDF • 1.5 МБ')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Открыть файл quarterly-report.pdf. PDF • 1.5 МБ'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMore).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('Действия с вложением quarterly-report.pdf'));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('shows inline download progress for TalkBack', async () => {
    const view = await render(
      <ChatDocumentAttachment
        attachment={{ id: 'attachment-1', file_name: 'report.pdf', file_size: 1024 }}
        width={240}
        transfer={{ action: 'open', progress: 0.42 }}
        onOpen={jest.fn()}
        onMore={jest.fn()}
      />,
    );

    expect(view.getByText('Загрузка 42%')).toBeTruthy();
    expect(view.getByRole('progressbar', { name: 'Загрузка 42%: report.pdf' }).props.accessibilityValue)
      .toEqual({ min: 0, max: 100, now: 42, text: '42 процентов' });
  });

  it('offers a 44dp cancel action during an upload', async () => {
    const onCancel = jest.fn();
    const view = await render(
      <ChatDocumentAttachment
        attachment={{ id: 'pending-1', file_name: 'report.pdf', file_size: 1024 }}
        width={240}
        transfer={{ action: 'upload', progress: 0.42, status: 'active', cancellable: true }}
        onCancel={onCancel}
      />,
    );

    expect(view.getByText('Отправка 42%')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Отменить: report.pdf'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers retry after a cancelled transfer', async () => {
    const onRetry = jest.fn();
    const view = await render(
      <ChatDocumentAttachment
        attachment={{ id: 'pending-1', file_name: 'report.pdf', file_size: 1024 }}
        width={240}
        transfer={{ action: 'upload', progress: 0.42, status: 'cancelled' }}
        onRetry={onRetry}
      />,
    );

    expect(view.getByText('Отправка отменена')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Повторить: report.pdf'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('formats extension and byte sizes without inventing missing metadata', () => {
    expect(getChatFileExtension('archive.tar.gz')).toBe('GZ');
    expect(getChatFileExtension('', 'image/png')).toBe('IMG');
    expect(formatChatFileSize(999)).toBe('999 Б');
    expect(formatChatFileSize(1024)).toBe('1.0 КБ');
    expect(formatChatFileSize(0)).toBe('');
  });
});
