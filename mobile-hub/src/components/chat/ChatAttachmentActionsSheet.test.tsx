import { fireEvent, render } from '@testing-library/react-native';
import { ChatAttachmentActionsSheet } from './ChatAttachmentActionsSheet';

describe('ChatAttachmentActionsSheet', () => {
  it('shows the same primary attachment actions and closes from the empty backdrop', async () => {
    const onClose = jest.fn();
    const onOpen = jest.fn();
    const onShare = jest.fn();
    const onForward = jest.fn();
    const onSave = jest.fn();
    const view = await render(
      <ChatAttachmentActionsSheet
        attachment={{
          id: 'attachment-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        }}
        onClose={onClose}
        onOpen={onOpen}
        onShare={onShare}
        onForward={onForward}
        onSave={onSave}
      />,
    );

    expect(view.getByText('report.pdf')).toBeTruthy();
    expect(view.getByLabelText('Открыть')).toBeTruthy();
    expect(view.getByLabelText('Поделиться')).toBeTruthy();
    expect(view.getByLabelText('Переслать')).toBeTruthy();
    expect(view.getByLabelText('Сохранить в «Мои файлы»')).toBeTruthy();

    await fireEvent.press(view.getByTestId('chat-attachment-actions-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('Открыть'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
