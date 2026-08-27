import * as ImagePicker from 'expo-image-picker';
import {
  buildAttachmentFormData,
  buildAttachmentsFormData,
  pickNativeAttachment,
} from './nativeFilePicker';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ type: 'image/jpeg', size: 0 })),
}));

jest.mock('./filePolicy', () => ({
  validateUploadBatch: (files: unknown[]) => files,
  validateUploadFile: ({ name, mimeType, size }: { name: string; mimeType?: string; size: number }) => ({
    name,
    mimeType: mimeType || 'image/jpeg',
    size,
  }),
}));

it('uses the backend multipart field names for a chat attachment with a reply', () => {
  const originalFormData = global.FormData;
  const append = jest.fn();
  global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
  try {
    buildAttachmentFormData({
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 256,
      source: 'document',
    }, {
      body: 'Смотрите отчёт',
      replyToMessageId: 'message-1',
    });

    expect(append).toHaveBeenCalledWith('files', expect.objectContaining({
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      type: 'application/pdf',
    }));
    expect(append).toHaveBeenCalledWith('body', 'Смотрите отчёт');
    expect(append).toHaveBeenCalledWith('reply_to_message_id', 'message-1');
  } finally {
    global.FormData = originalFormData;
  }
});

it('sends voice metadata through the existing files_meta_json contract', () => {
  const originalFormData = global.FormData;
  const append = jest.fn();
  global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
  try {
    buildAttachmentFormData({
      uri: 'file:///cache/voice.m4a',
      name: 'voice_1.m4a',
      mimeType: 'audio/mp4',
      size: 2048,
      source: 'voice',
    }, {
      mediaKind: 'audio',
      durationSeconds: 8,
    });
    expect(append).toHaveBeenCalledWith('files_meta_json', JSON.stringify([{
      transfer_encoding: 'identity',
      media_kind: 'audio',
      duration_seconds: 8,
      original_size: 2048,
    }]));
  } finally {
    global.FormData = originalFormData;
  }
});

it('puts several selected files into one backend multipart message', () => {
  const originalFormData = global.FormData;
  const append = jest.fn();
  global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
  try {
    buildAttachmentsFormData([{
      uri: 'file:///cache/one.jpg',
      name: 'one.jpg',
      mimeType: 'image/jpeg',
      size: 100,
      source: 'gallery',
    }, {
      uri: 'file:///cache/two.mp4',
      name: 'two.mp4',
      mimeType: 'video/mp4',
      size: 200,
      source: 'gallery',
    }], { body: 'Альбом', clientMessageId: 'mobile-files-1' });

    expect(append.mock.calls.filter(([field]) => field === 'files')).toHaveLength(2);
    expect(append).toHaveBeenCalledWith('files_meta_json', JSON.stringify([{
      transfer_encoding: 'identity',
      original_size: 100,
    }, {
      transfer_encoding: 'identity',
      original_size: 200,
    }]));
    expect(append).toHaveBeenCalledWith('body', 'Альбом');
    expect(append).toHaveBeenCalledWith('client_message_id', 'mobile-files-1');
  } finally {
    global.FormData = originalFormData;
  }
});

it('marks every system document as a file even when its MIME type is an image', () => {
  const originalFormData = global.FormData;
  const append = jest.fn();
  global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
  try {
    buildAttachmentsFormData([{
      uri: 'file:///cache/original.png',
      name: 'original.png',
      mimeType: 'image/png',
      size: 100,
      source: 'document',
    }, {
      uri: 'file:///cache/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 200,
      source: 'document',
    }]);

    expect(append).toHaveBeenCalledWith('files_meta_json', JSON.stringify([{
      transfer_encoding: 'identity',
      media_kind: 'file',
      original_size: 100,
    }, {
      transfer_encoding: 'identity',
      media_kind: 'file',
      original_size: 200,
    }]));
  } finally {
    global.FormData = originalFormData;
  }
});

it('picks a gallery photo without the system crop dialog', async () => {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: true,
    assets: [],
  });

  await pickNativeAttachment('gallery');

  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
    allowsEditing: false,
    allowsMultipleSelection: true,
    quality: 0.85,
    selectionLimit: 5,
  }));
});
