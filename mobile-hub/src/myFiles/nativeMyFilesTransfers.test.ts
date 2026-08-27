import {
  readNativeMyFileTextPreview,
  resolveMyFileDownloadGrantUrl,
  resolveMyFilePreviewContentUrl,
} from './nativeMyFilesTransfers';

it('accepts only an exact relative one-time My Files grant path', () => {
  const url = resolveMyFileDownloadGrantUrl('/my-files/download-grant/token_1234567890123456');
  expect(url).toContain('/api/v1/my-files/download-grant/token_1234567890123456');
  expect(() => resolveMyFileDownloadGrantUrl('https://evil.example/file')).toThrow('недопустимую');
  expect(() => resolveMyFileDownloadGrantUrl('/my-files/public/token/download')).toThrow('недопустимую');
});

it('builds preview content only on the trusted authenticated API origin', () => {
  expect(resolveMyFilePreviewContentUrl('file/1')).toContain('/api/v1/my-files/file%2F1/preview/content');
  expect(() => resolveMyFilePreviewContentUrl('')).toThrow('Не выбран');
});

it('renders text as inert plain content and replaces null bytes', async () => {
  const file = { exists: true, size: 12, text: jest.fn().mockResolvedValue('<script>bad()</script>\0') };
  await expect(readNativeMyFileTextPreview(file as never)).resolves.toBe('<script>bad()</script>�');
});
