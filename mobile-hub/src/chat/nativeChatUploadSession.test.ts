import {
  completeChatUploadSession,
  createChatUploadSession,
  getChatUploadSession,
  sendFileMessage,
  uploadChatFileChunk,
} from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import type { ChatUploadSession } from '../api/chatApi';
import { deliverNativeChatUpload } from './nativeChatUploadSession';
import type { NativeChatOutboxEntry } from './nativeChatOutbox';

const mockFiles = new Map<string, { size: number }>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = segments.length ? [base.replace(/\/$/, ''), ...segments].join('/') : base;
    }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.size || 0; }
    open() {
      const file = this;
      return {
        offset: 0,
        readBytes(length: number) {
          return new Uint8Array(Math.max(0, Math.min(Number(length) || 0, file.size - Number(this.offset) || 0)));
        },
        close() {},
      };
    }
  }
  return {
    File: MockFile,
    FileMode: { ReadOnly: 'r' },
    Paths: { cache: 'file:///cache', document: 'file:///document' },
  };
});

jest.mock('../api/chatApi', () => ({
  createChatUploadSession: jest.fn(),
  getChatUploadSession: jest.fn(),
  uploadChatFileChunk: jest.fn(),
  completeChatUploadSession: jest.fn(),
  cancelChatUploadSession: jest.fn(),
  sendFileMessage: jest.fn(),
}));
jest.mock('../files/nativeFilePicker', () => ({
  buildAttachmentsFormData: jest.fn(() => 'FORM_DATA'),
  // Same classification as the real helper — kept inline so the unit test
  // stays hermetic and does not need expo picker/file-system mocks.
  inferNativeUploadMediaKind: (
    file: { source: string; mimeType: string },
    explicitKind?: 'image' | 'video' | 'file' | 'audio',
    index = 0,
  ) => {
    if (explicitKind && index === 0) return explicitKind;
    if (file.source === 'document') return 'file';
    const mime = String(file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'file';
  },
}));

const message: ChatMessage = {
  id: 'pending:up-1', client_message_id: 'up-1', conversation_id: 'chat-a',
  sender_user_id: 7, body_text: '',
};
const confirmed: ChatMessage = { ...message, id: 'server-1', local_status: undefined };

function session(overrides: Partial<ChatUploadSession> = {}): ChatUploadSession {
  return {
    session_id: 'sess-1', chunk_size_bytes: 8, expires_at: '', status: 'pending',
    message_id: null,
    files: [{
      file_id: 'f-1', file_name: 'report.pdf', mime_type: 'application/pdf',
      media_kind: null, duration_seconds: null, size: 24, original_size: 24,
      transfer_encoding: 'identity', chunk_count: 3, received_bytes: 0, received_chunks: [],
    }],
    ...overrides,
  };
}

function entry(upload?: Partial<NativeChatOutboxEntry['upload'] & object>): NativeChatOutboxEntry {
  return {
    userId: 7, message,
    upload: {
      body: 'Подпись',
      files: [{ uri: 'file:///document/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 24, source: 'document' }],
      ...(upload || {}),
    },
  } as NativeChatOutboxEntry;
}

beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
  mockFiles.set('file:///document/report.pdf', { size: 24 });
  jest.mocked(uploadChatFileChunk).mockImplementation(async (_s, _f, chunkIndex, _chunk, options) => ({
    session_id: 'sess-1', file_id: 'f-1', chunk_index: chunkIndex, already_present: false,
    received_bytes: (chunkIndex + 1) * 8, received_chunks: Array.from({ length: chunkIndex + 1 }, (_v, i) => i),
    file_complete: chunkIndex === 2,
  }));
  jest.mocked(completeChatUploadSession).mockResolvedValue(confirmed);
});

it('uploads a file in sequential chunks and completes the session', async () => {
  jest.mocked(createChatUploadSession).mockResolvedValue(session());
  const patchUpload = jest.fn().mockResolvedValue(undefined);
  const progress: Array<[number, number | null]> = [];

  const result = await deliverNativeChatUpload(entry(), {
    helpers: { patchUpload },
    onProgress: (loaded, total) => progress.push([loaded, total]),
  });

  expect(result.id).toBe('server-1');
  expect(createChatUploadSession).toHaveBeenCalledWith('chat-a', expect.objectContaining({
    clientMessageId: 'up-1',
    files: [expect.objectContaining({ file_name: 'report.pdf', size: 24, original_size: 24, media_kind: 'file' })],
  }), expect.anything());
  expect(patchUpload).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  expect(jest.mocked(uploadChatFileChunk).mock.calls.map((call) => call[4].offset)).toEqual([0, 8, 16]);
  expect(completeChatUploadSession).toHaveBeenCalledWith('sess-1', expect.anything());
  expect(progress.at(-1)).toEqual([24, 24]);
});

it('creates the upload session with per-file media metadata for a mixed batch', async () => {
  mockFiles.set('file:///document/clip.mp4', { size: 24 });
  const mixed = {
    userId: 7, message,
    upload: {
      body: '',
      files: [
        { uri: 'file:///document/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 24, source: 'gallery' as const },
        { uri: 'file:///document/clip.mp4', name: 'clip.mp4', mimeType: 'video/mp4', size: 24, source: 'gallery' as const },
      ],
    },
  } as NativeChatOutboxEntry;
  jest.mocked(createChatUploadSession).mockResolvedValue(session({
    files: [
      session().files[0],
      {
        ...session().files[0],
        file_id: 'f-2', file_name: 'clip.mp4', mime_type: 'video/mp4',
      },
    ],
  }));

  await deliverNativeChatUpload(mixed, { helpers: { patchUpload: jest.fn() } });

  // UP-1: every file is classified by its own MIME type, not only files[0].
  expect(createChatUploadSession).toHaveBeenCalledWith('chat-a', expect.objectContaining({
    files: [
      expect.objectContaining({ file_name: 'report.pdf', media_kind: 'file' }),
      expect.objectContaining({ file_name: 'clip.mp4', media_kind: 'video' }),
    ],
  }), expect.anything());
});

it('reattaches to the persisted session and resumes after the acknowledged chunks', async () => {
  jest.mocked(getChatUploadSession).mockResolvedValue(session({
    files: [{ ...session().files[0], received_bytes: 16, received_chunks: [0, 1] }],
  }));

  await deliverNativeChatUpload(entry({ sessionId: 'sess-1' }), {
    helpers: { patchUpload: jest.fn() },
  });

  expect(createChatUploadSession).not.toHaveBeenCalled();
  expect(jest.mocked(uploadChatFileChunk).mock.calls.map((call) => call[2])).toEqual([2]);
  expect(completeChatUploadSession).toHaveBeenCalledWith('sess-1', expect.anything());
});

it('keeps the same client_message_id when the stored session expired', async () => {
  jest.mocked(getChatUploadSession).mockRejectedValue(Object.assign(new Error('gone'), { response: { status: 404 } }));
  jest.mocked(createChatUploadSession).mockResolvedValue(session({ session_id: 'sess-2' }));
  const patchUpload = jest.fn().mockResolvedValue(undefined);

  await deliverNativeChatUpload(entry({ sessionId: 'sess-old' }), { helpers: { patchUpload } });

  expect(patchUpload).toHaveBeenNthCalledWith(1, { sessionId: undefined });
  expect(createChatUploadSession).toHaveBeenCalledWith('chat-a',
    expect.objectContaining({ clientMessageId: 'up-1' }), expect.anything());
  expect(patchUpload).toHaveBeenNthCalledWith(2, { sessionId: 'sess-2' });
});

it('refreshes server progress instead of resending a chunk that already landed', async () => {
  jest.mocked(createChatUploadSession).mockResolvedValue(session());
  jest.mocked(uploadChatFileChunk)
    .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('net'), { code: 'ERR_NETWORK' })))
    .mockImplementation(async (_s, _f, chunkIndex, _chunk, options) => ({
      session_id: 'sess-1', file_id: 'f-1', chunk_index: chunkIndex, already_present: false,
      received_bytes: (chunkIndex + 1) * 8, received_chunks: Array.from({ length: chunkIndex + 1 }, (_v, i) => i),
      file_complete: chunkIndex === 2,
    }));
  // The first chunk actually reached the server before the network error.
  jest.mocked(getChatUploadSession).mockResolvedValue(session({
    files: [{ ...session().files[0], received_bytes: 8, received_chunks: [0] }],
  }));

  await deliverNativeChatUpload(entry(), { helpers: { patchUpload: jest.fn() } });

  expect(jest.mocked(uploadChatFileChunk).mock.calls.map((call) => call[2])).toEqual([0, 1, 2]);
  expect(completeChatUploadSession).toHaveBeenCalled();
}, 15000);

it('returns the message when the persisted session is already completed', async () => {
  jest.mocked(getChatUploadSession).mockResolvedValue(session({
    status: 'completed', message_id: 'server-1',
    files: [{ ...session().files[0], received_bytes: 24, received_chunks: [0, 1, 2] }],
  }));

  const result = await deliverNativeChatUpload(entry({ sessionId: 'sess-1' }), {
    helpers: { patchUpload: jest.fn() },
  });

  expect(result.id).toBe('server-1');
  expect(uploadChatFileChunk).not.toHaveBeenCalled();
  expect(completeChatUploadSession).toHaveBeenCalledWith('sess-1', expect.anything());
});

it('falls back to a multipart send when the session endpoint is unavailable', async () => {
  jest.mocked(createChatUploadSession).mockRejectedValue(Object.assign(new Error('missing'), { response: { status: 404 } }));
  jest.mocked(sendFileMessage).mockResolvedValue(confirmed);

  const result = await deliverNativeChatUpload(entry(), { helpers: { patchUpload: jest.fn() } });

  expect(result.id).toBe('server-1');
  expect(sendFileMessage).toHaveBeenCalledWith('chat-a', 'FORM_DATA', expect.anything());
  expect(uploadChatFileChunk).not.toHaveBeenCalled();
});

it('does not fall back on client rejection and reports aborts immediately', async () => {
  jest.mocked(createChatUploadSession).mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
  await expect(deliverNativeChatUpload(entry(), { helpers: { patchUpload: jest.fn() } })).rejects.toThrow('forbidden');
  expect(sendFileMessage).not.toHaveBeenCalled();

  const controller = new AbortController();
  controller.abort();
  jest.mocked(createChatUploadSession).mockRejectedValue(Object.assign(new Error('net'), { code: 'ERR_NETWORK' }));
  await expect(deliverNativeChatUpload(entry(), { signal: controller.signal, helpers: { patchUpload: jest.fn() } }))
    .rejects.toThrow('net');
  expect(sendFileMessage).not.toHaveBeenCalled();
});
