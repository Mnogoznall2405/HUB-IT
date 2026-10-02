import { act, renderHook } from '@testing-library/react-native';
import React from 'react';
import { useThreadComposerState } from './useThreadComposerState';
import { useThreadSend } from './useThreadSend';
import type { HubUser } from '../../api/types';
import type { NativePickedFile } from '../../files/nativeFilePicker';

jest.mock('../../chat/chatSocket', () => ({
  chatSocket: { sendTyping: jest.fn(), on: jest.fn(() => () => {}) },
}));

const user = { id: 7, username: 'user-7', full_name: 'Пользователь' } as HubUser;

type FakeOutbox = { queue: jest.Mock };

function useHarness(outbox: FakeOutbox) {
  const sendScope = React.useMemo(() => Symbol('send-scope'), []);
  const composer = useThreadComposerState({
    conversationId: 'chat-a',
    userId: 7,
    canWrite: true,
    offlineMode: false,
    sendScope,
    messages: [],
  });
  const mountedRef = React.useRef(true);
  const messageEnterMotionsRef = React.useRef(new Map());
  const knownMessageIdsRef = React.useRef(new Set<string>());
  const pendingAttachmentUploadsRef = React.useRef(new Map());
  const uploadControllersRef = React.useRef(new Map<string, AbortController>());
  const send = useThreadSend({
    conversationId: 'chat-a',
    user,
    canWrite: true,
    offlineMode: false,
    isCurrentSendScope: () => true,
    mountedRef,
    outbox: outbox as never,
    requestBottomAnchor: () => {},
    setMessages: () => {},
    messageEnterMotionsRef,
    knownMessageIdsRef,
    pendingAttachmentUploadsRef: pendingAttachmentUploadsRef as never,
    uploadControllersRef,
    setAttachmentTransfers: () => {},
    setEmojiPickerVisible: () => {},
    composer,
  });
  return { composer, send };
}

const photo: NativePickedFile = {
  uri: 'file:///drafts/photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 100,
  source: 'gallery',
};

// AUD-9: a double tap on a non-text send must not create a duplicate message.
it('ignores a second poll send while the first is in flight', async () => {
  let release!: (value: unknown) => void;
  const queue = jest.fn((_message: { client_message_id?: string }) => (
    new Promise((resolve) => { release = resolve; })
  ));
  const view = await renderHook(() => useHarness({ queue }));
  try {
    await act(async () => {
      const first = view.result.current.send.sendPoll('Вопрос', ['Да', 'Нет']);
      const second = view.result.current.send.sendPoll('Вопрос', ['Да', 'Нет']);
      release({ message: { local_status: 'failed' } });
      await Promise.all([first, second]);
    });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue.mock.calls[0]?.[0]?.client_message_id).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

// AUD-1: after a queue rejection the restored composer draft keeps the same
// client_message_id — a retry must not create a duplicate bubble/message.
it('reuses the same client_message_id when a failed attachment draft send is retried', async () => {
  const queue = jest.fn(async (_message: { client_message_id?: string }) => ({ message: { local_status: 'failed' } }));
  queue.mockRejectedValueOnce(new Error('Storage down'));
  const view = await renderHook(() => useHarness({ queue }));
  try {
    await act(async () => {
      view.result.current.composer.setAttachmentDraftFiles([photo]);
    });
    // The idempotency key is created when the files enter the composer draft.
    view.result.current.send.attachmentDraftClientMessageIdRef.current = 'draft-id-1';
    await act(async () => {
      await view.result.current.send.sendAttachmentDraft();
    });
    expect(queue).toHaveBeenCalledTimes(1);
    // The failure restored the files together with the original id.
    expect(view.result.current.send.attachmentDraftClientMessageIdRef.current).toBe('draft-id-1');
    await act(async () => {
      await view.result.current.send.sendAttachmentDraft();
    });
    expect(queue).toHaveBeenCalledTimes(2);
    expect(queue.mock.calls.map(([message]) => message.client_message_id)).toEqual(['draft-id-1', 'draft-id-1']);
  } finally {
    await view.unmount();
  }
});
