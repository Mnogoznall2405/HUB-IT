import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatStructuredSend from './useChatStructuredSend';

vi.mock('../../api/client', () => ({
  chatAPI: {
    sendMessage: vi.fn(),
  },
}));

const buildArgs = (overrides = {}) => ({
  activeConversationId: 'conv-1',
  applyOutgoingThreadMessage: vi.fn(),
  notifyApiError: vi.fn(),
  notifyWarning: vi.fn(),
  setComposerMenuAnchor: vi.fn(),
  ...overrides,
});

describe('useChatStructuredSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAPI.sendMessage.mockResolvedValue({ id: 'server-1' });
  });

  it('sends a poll as kind=poll JSON body with a client_message_id', async () => {
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    act(() => result.current.openPollDialog());
    expect(result.current.structuredDialog).toBe('poll');
    expect(args.setComposerMenuAnchor).toHaveBeenCalledWith(null);

    let sent;
    await act(async () => {
      sent = await result.current.sendPollMessage({
        question: '  Lunch? ',
        options: [' Yes ', '', 'No'],
        anonymous: true,
      });
    });

    expect(sent).toBe(true);
    expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);
    const [conversationId, body, options] = chatAPI.sendMessage.mock.calls[0];
    expect(conversationId).toBe('conv-1');
    expect(options.kind).toBe('poll');
    expect(options.client_message_id).toEqual(expect.any(String));
    expect(JSON.parse(body)).toEqual({ question: 'Lunch?', options: ['Yes', 'No'], anonymous: true });
    // R14: own sends always scroll the thread to the bottom.
    expect(args.applyOutgoingThreadMessage).toHaveBeenCalledWith('conv-1', { id: 'server-1' }, {
      scroll: true,
      scrollSource: 'sendStructured',
    });
    expect(result.current.structuredDialog).toBe(null);
  });

  it('rejects a poll without a question or with fewer than two options', async () => {
    const { result } = renderHook(() => useChatStructuredSend(buildArgs()));

    let sent;
    await act(async () => {
      sent = await result.current.sendPollMessage({ question: '', options: ['a', 'b'] });
    });
    expect(sent).toBe(false);
    await act(async () => {
      sent = await result.current.sendPollMessage({ question: 'Q', options: ['a'] });
    });
    expect(sent).toBe(false);
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a contact with name, phone and organization', async () => {
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    act(() => result.current.openContactDialog());
    expect(result.current.structuredDialog).toBe('contact');

    let sent;
    await act(async () => {
      sent = await result.current.sendContactMessage({
        name: 'Иван Иванов',
        phone: '+7 900 111-22-33',
        organization: 'ИТ-отдел',
      });
    });

    expect(sent).toBe(true);
    const [, body, options] = chatAPI.sendMessage.mock.calls[0];
    expect(options.kind).toBe('contact');
    expect(JSON.parse(body)).toEqual({
      name: 'Иван Иванов',
      phone: '+7 900 111-22-33',
      organization: 'ИТ-отдел',
    });
    expect(result.current.structuredDialog).toBe(null);
  });

  it('requests geolocation, opens a confirmation dialog and sends only after confirm', async () => {
    const getCurrentPosition = vi.fn((resolve) => resolve({
      coords: { latitude: 55.75, longitude: 37.61, accuracy: 42 },
    }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    let resolved;
    await act(async () => {
      resolved = await result.current.sendLocationMessage();
    });

    // R13: resolving the position only opens the dialog — nothing is sent yet.
    expect(resolved).toBe(true);
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
    expect(result.current.structuredDialog).toBe('location');
    expect(result.current.locationDraft).toEqual({ latitude: 55.75, longitude: 37.61, accuracy: 42 });

    let sent;
    await act(async () => {
      sent = await result.current.confirmLocationMessage();
    });

    expect(sent).toBe(true);
    expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);
    const [, body, options] = chatAPI.sendMessage.mock.calls[0];
    expect(options.kind).toBe('location');
    expect(options.client_message_id).toEqual(expect.any(String));
    expect(JSON.parse(body)).toEqual({ latitude: 55.75, longitude: 37.61 });
    expect(result.current.structuredDialog).toBe(null);
    expect(result.current.locationDraft).toBe(null);
    vi.unstubAllGlobals();
  });

  it('cancelling the location dialog sends zero requests and clears the draft', async () => {
    const getCurrentPosition = vi.fn((resolve) => resolve({
      coords: { latitude: 55.75, longitude: 37.61, accuracy: 42 },
    }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    await act(async () => {
      await result.current.sendLocationMessage();
    });
    expect(result.current.structuredDialog).toBe('location');

    act(() => result.current.closeStructuredDialog());

    expect(result.current.structuredDialog).toBe(null);
    expect(result.current.locationDraft).toBe(null);
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();

    let sent;
    await act(async () => {
      sent = await result.current.confirmLocationMessage();
    });
    expect(sent).toBe(false);
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows a clear warning when geolocation permission is denied', async () => {
    const denied = Object.assign(new Error('denied'), { code: 1 });
    const getCurrentPosition = vi.fn((_resolve, reject) => reject(denied));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    let sent;
    await act(async () => {
      sent = await result.current.sendLocationMessage();
    });

    expect(sent).toBe(false);
    expect(chatAPI.sendMessage).not.toHaveBeenCalled();
    expect(args.notifyWarning).toHaveBeenCalledWith(
      expect.stringContaining('Нет доступа к геопозиции'),
    );
    vi.unstubAllGlobals();
  });

  it('warns when the browser has no geolocation support', async () => {
    vi.stubGlobal('navigator', {});
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    let sent;
    await act(async () => {
      sent = await result.current.sendLocationMessage();
    });

    expect(sent).toBe(false);
    expect(args.notifyWarning).toHaveBeenCalledWith('Геопозиция недоступна в этом браузере.');
    vi.unstubAllGlobals();
  });

  it('surfaces send failures via notifyApiError and keeps the dialog open', async () => {
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('500'));
    const args = buildArgs();
    const { result } = renderHook(() => useChatStructuredSend(args));

    act(() => result.current.openPollDialog());
    let sent;
    await act(async () => {
      sent = await result.current.sendPollMessage({ question: 'Q', options: ['a', 'b'] });
    });

    expect(sent).toBe(false);
    expect(args.notifyApiError).toHaveBeenCalled();
    expect(result.current.structuredDialog).toBe('poll');
  });
});
