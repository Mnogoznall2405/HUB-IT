import {
  buildPendingAttachmentMessage,
  isAttachmentTransferAbort,
  pendingAttachmentId,
} from './chatAttachmentTransfers';

describe('native chat attachment transfers', () => {
  it('builds an own optimistic message with stable local attachment ids', () => {
    const message = buildPendingAttachmentMessage({
      conversationId: 'conversation-1',
      clientMessageId: 'client-1',
      body: 'Материалы',
      files: [{
        uri: 'file:///cache/report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        source: 'document',
      }],
      sender: { id: 7, username: 'user' },
    });

    expect(message).toMatchObject({
      id: 'pending:client-1',
      client_message_id: 'client-1',
      local_status: 'sending',
      is_own: true,
      body_text: 'Материалы',
    });
    expect(message.attachments?.[0]).toMatchObject({
      id: pendingAttachmentId('client-1', 0),
      kind: 'file',
      file_name: 'report.pdf',
      local_uri: 'file:///cache/report.pdf',
    });
  });

  it('recognizes AbortController and axios cancellation errors', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAttachmentTransferAbort(new Error('request failed'), controller.signal)).toBe(true);
    expect(isAttachmentTransferAbort({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isAttachmentTransferAbort(new Error('network unavailable'))).toBe(false);
  });
});
