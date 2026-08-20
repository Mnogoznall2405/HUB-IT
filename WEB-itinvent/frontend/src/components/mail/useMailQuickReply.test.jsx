import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailQuickReply, { buildQuickReplyHtml } from './useMailQuickReply';
import { MAIL_SEND_MAYBE_SENT_MESSAGE, MAIL_SEND_NOT_SENT_MESSAGE } from './mailSendOutcome';

function buildMessage(overrides = {}) {
  return {
    id: 'msg-1',
    subject: 'Hello',
    mailbox_id: 'mb-1',
    sender_email: 'sender@example.com',
    compose_context: {
      reply: {
        to: ['sender@example.com'],
        cc: [],
        subject: 'Hello',
        mailbox_id: 'mb-1',
      },
    },
    ...overrides,
  };
}

describe('useMailQuickReply', () => {
  it('sends body argument and bumps draftEpoch only on success', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    expect(result.current.draftEpoch).toBe(0);

    let ok;
    await act(async () => {
      ok = await result.current.sendQuickReply(buildMessage(), '  Привет  ');
    });

    expect(ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].body).toBe(buildQuickReplyHtml('Привет'));
    expect(result.current.draftEpoch).toBe(1);
  });

  it('does not bump draftEpoch on send failure', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('HTTP 500'));
    const onError = vi.fn();
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
      getMailErrorDetail: () => 'fail',
      onError,
    }));

    let ok;
    await act(async () => {
      ok = await result.current.sendQuickReply(buildMessage(), 'Draft stays');
    });

    expect(ok).toBe(false);
    expect(result.current.draftEpoch).toBe(0);
    expect(onError).toHaveBeenCalled();
  });

  it('rejects empty body without calling API', async () => {
    const sendMessage = vi.fn();
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    let ok;
    await act(async () => {
      ok = await result.current.sendQuickReply(buildMessage(), '   ');
    });

    expect(ok).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.draftEpoch).toBe(0);
  });

  it('Smart Reply path passes text directly as body argument', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    const smartReplyText = 'Sounds good';
    await act(async () => {
      await result.current.sendQuickReply(buildMessage(), smartReplyText);
    });

    expect(sendMessage.mock.calls[0][0].body).toBe(buildQuickReplyHtml(smartReplyText));
    expect(result.current.draftEpoch).toBe(1);
  });

  it('sends Quick Reply to compose_context.reply.to including Reply-To', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    await act(async () => {
      await result.current.sendQuickReply(buildMessage({
        sender_email: 'boss@example.com',
        compose_context: {
          reply: {
            to: ['tickets@example.com'],
            cc: [],
            subject: 'Help',
            mailbox_id: 'mb-1',
          },
        },
      }), 'Принято');
    });

    expect(sendMessage.mock.calls[0][0].to).toEqual(['tickets@example.com']);
  });

  it('uses reply-all recipients when mode is reply_all', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    await act(async () => {
      await result.current.sendQuickReply(buildMessage({
        compose_context: {
          reply: { to: ['sender@example.com'], cc: [] },
          reply_all: {
            to: ['sender@example.com', 'ivanov@company.ru'],
            cc: ['cc@example.com'],
            subject: 'Hello',
            mailbox_id: 'mb-1',
          },
        },
      }), 'Всем', { mode: 'reply_all' });
    });

    expect(sendMessage.mock.calls[0][0].to).toEqual(['sender@example.com', 'ivanov@company.ru']);
    expect(sendMessage.mock.calls[0][0].cc).toEqual(['cc@example.com']);
  });

  it('appends quoted original html so the conversation history is sent', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));

    await act(async () => {
      await result.current.sendQuickReply(buildMessage({
        compose_context: {
          reply: {
            to: ['sender@example.com'],
            cc: [],
            subject: 'Hello',
            mailbox_id: 'mb-1',
            quote_html: '<div class="quoted-mail"><blockquote>Предыдущее письмо</blockquote></div>',
          },
        },
      }), 'Согласен');
    });

    const sentBody = sendMessage.mock.calls[0][0].body;
    expect(sentBody).toContain(buildQuickReplyHtml('Согласен'));
    expect(sentBody).toContain('Предыдущее письмо');
    expect(sentBody.indexOf('Согласен')).toBeLessThan(sentBody.indexOf('Предыдущее письмо'));
  });

  it('does not start a second send while the first is in flight', async () => {
    let resolveSend;
    const sendMessage = vi.fn(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
    }));
    const message = buildMessage();

    let first;
    let second;
    await act(async () => {
      first = result.current.sendQuickReply(message, 'Hello');
      second = result.current.sendQuickReply(message, 'Hello');
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend({});
      await Promise.all([first, second]);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result.current.quickReplySending).toBe(false);
  });

  it('reuses the same idempotency key after a failed send', async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
      getMailErrorDetail: () => 'fail',
      onError: vi.fn(),
    }));
    const message = buildMessage();

    await act(async () => {
      await result.current.sendQuickReply(message, 'Hello');
    });
    await act(async () => {
      await result.current.sendQuickReply(message, 'Hello');
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const firstKey = sendMessage.mock.calls[0][0].idempotencyKey;
    const secondKey = sendMessage.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(firstKey.length).toBeGreaterThanOrEqual(8);
    expect(secondKey).toBe(firstKey);
  });

  it('reports maybe-sent copy on timeout without a second send', async () => {
    const sendMessage = vi.fn().mockRejectedValue(Object.assign(new Error('timeout of 115000ms exceeded'), {
      code: 'ECONNABORTED',
    }));
    const onError = vi.fn();
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
      onError,
    }));

    await act(async () => {
      await result.current.sendQuickReply(buildMessage(), 'Hello');
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(MAIL_SEND_MAYBE_SENT_MESSAGE);
  });

  it('keeps server validation detail as not sent', async () => {
    const sendMessage = vi.fn().mockRejectedValue({
      response: { status: 400, data: { detail: 'At least one recipient is required' } },
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useMailQuickReply({
      mailAPI: { sendMessage },
      resolveComposeMailboxId: (id) => id,
      onError,
    }));

    await act(async () => {
      await result.current.sendQuickReply(buildMessage(), 'Hello');
    });

    expect(onError).toHaveBeenCalledWith('At least one recipient is required');
    expect(onError).not.toHaveBeenCalledWith(MAIL_SEND_NOT_SENT_MESSAGE);
  });
});
