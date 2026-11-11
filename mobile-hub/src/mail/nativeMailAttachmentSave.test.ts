const mockPickDirectory = jest.fn();
const mockDownloadAttachment = jest.fn();

jest.mock('expo-file-system', () => ({
  Directory: { pickDirectoryAsync: (...args: unknown[]) => mockPickDirectory(...args) },
}));

jest.mock('./nativeMailFiles', () => ({
  downloadMailAttachment: (...args: unknown[]) => mockDownloadAttachment(...args),
}));

import { saveNativeMailAttachmentsToDirectory } from './nativeMailAttachmentSave';

beforeEach(() => {
  jest.clearAllMocks();
});

it('downloads every attachment and preserves unique user-facing names', async () => {
  const created: Array<{ name: string; mimeType: string; delete: jest.Mock }> = [];
  mockPickDirectory.mockResolvedValue({
    name: 'Download',
    list: () => [{ name: 'report.pdf' }],
    createFile: (name: string, mimeType: string) => {
      const file = { name, mimeType, exists: true, delete: jest.fn() };
      created.push(file);
      return file;
    },
  });
  const copy = jest.fn(async () => undefined);
  mockDownloadAttachment.mockResolvedValue({ copy });

  const result = await saveNativeMailAttachmentsToDirectory('message-1', 'box-1', [
    { id: 'one', name: 'report.pdf', content_type: 'application/pdf' },
    { id: 'two', name: 'report.pdf', content_type: 'application/pdf' },
  ]);

  expect(created.map((item) => item.name)).toEqual(['report (2).pdf', 'report (3).pdf']);
  expect(created.map((item) => item.mimeType)).toEqual(['application/pdf', 'application/pdf']);
  expect(copy).toHaveBeenCalledTimes(2);
  expect(result).toEqual(expect.objectContaining({
    cancelled: false,
    directoryName: 'Download',
    saved: ['report (2).pdf', 'report (3).pdf'],
    failed: [],
  }));
});

it('normalizes a wrong Exchange MIME before saving the attachment', async () => {
  const createFile = jest.fn(() => ({ exists: true, delete: jest.fn() }));
  mockPickDirectory.mockResolvedValue({
    name: 'Download',
    list: () => [],
    createFile,
  });
  mockDownloadAttachment.mockResolvedValue({
    type: 'application/octet-stream',
    copy: jest.fn(async () => undefined),
  });

  await saveNativeMailAttachmentsToDirectory('message-1', 'box-1', [
    { id: 'one', name: 'contract.docx', content_type: 'application/zip' },
  ]);

  expect(createFile).toHaveBeenCalledWith(
    'contract.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
});

it('treats closing the folder picker as cancellation without a false error', async () => {
  mockPickDirectory.mockRejectedValue(new Error('The file picker was cancelled by the user'));

  await expect(saveNativeMailAttachmentsToDirectory('message-1', 'box-1', [{ id: 'one', name: 'one.pdf' }]))
    .resolves.toEqual({ cancelled: true, directoryName: '', saved: [], failed: [] });
  expect(mockDownloadAttachment).not.toHaveBeenCalled();
});
