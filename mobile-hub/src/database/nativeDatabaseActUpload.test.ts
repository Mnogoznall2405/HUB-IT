import * as DocumentPicker from 'expo-document-picker';
import {
  NATIVE_DATABASE_ACT_MAX_BYTES,
  normalizeUploadedActInventoryInput,
  pickNativeDatabaseActPdf,
  validateNativeDatabaseActPdf,
} from './nativeDatabaseActUpload';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    exists: true,
    name: 'signed.pdf',
    type: 'application/pdf',
    size: 2048,
  })),
}));

it('opens the native picker for one cached PDF and validates the server size limit', async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///cache/signed.pdf', name: 'signed.pdf', mimeType: 'application/pdf', size: 2048 }],
  });
  await expect(pickNativeDatabaseActPdf()).resolves.toEqual({
    uri: 'file:///cache/signed.pdf', name: 'signed.pdf', mimeType: 'application/pdf', size: 2048,
  });
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
    copyToCacheDirectory: true,
    multiple: false,
    type: 'application/pdf',
  });
  expect(() => validateNativeDatabaseActPdf({
    uri: 'file:///large.pdf', name: 'large.pdf', mimeType: 'application/pdf', size: NATIVE_DATABASE_ACT_MAX_BYTES + 1,
  })).toThrow('15 МБ');
});

it('normalizes the numeric inventory format used by the existing web act wizard', () => {
  expect(normalizeUploadedActInventoryInput('№001, 2.0; 2 invalid 003')).toEqual(['1', '2', '3']);
});
