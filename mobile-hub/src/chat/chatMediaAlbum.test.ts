import type { ChatMessage } from '../api/types';
import { buildChatMediaAlbumMap } from './chatMediaAlbum';

const photo = (id: string) => ({ id: `a-${id}`, kind: 'image', mime_type: 'image/jpeg', preview_url: `https://x/${id}.jpg` });

function message(id: string, attachments: unknown[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    kind: 'file',
    body_text: '',
    sender_user_id: 7,
    created_at: '2026-09-25T10:00:00Z',
    attachments,
    ...overrides,
  } as ChatMessage;
}

describe('buildChatMediaAlbumMap', () => {
  it('turns the photos of one kind:file message into an album with its caption', () => {
    const map = buildChatMediaAlbumMap([message('m1', [photo('1'), photo('2')], { body_text: 'Комплект' })]);
    expect(map.get('m1')?.entries).toHaveLength(2);
    expect(map.get('m1')?.headId).toBe('m1');
    expect(map.get('m1')?.caption).toBe('Комплект');
  });

  it('never merges separate single-photo messages sent one after another', () => {
    const map = buildChatMediaAlbumMap([
      message('m2', [photo('2')], { created_at: '2026-09-25T10:00:20Z' }),
      message('m1', [photo('1')]),
    ]);
    expect(map.size).toBe(0);
  });

  it('keeps two multi-photo messages as two separate albums', () => {
    const map = buildChatMediaAlbumMap([
      message('m2', [photo('3'), photo('4')]),
      message('m1', [photo('1'), photo('2')]),
    ]);
    expect(map.get('m1')?.entries.map((entry) => entry.message.id)).toEqual(['m1', 'm1']);
    expect(map.get('m2')?.headId).toBe('m2');
  });

  it('accepts a mixed photo and video set', () => {
    const video = { id: 'v-1', kind: 'video', mime_type: 'video/mp4', preview_url: 'https://x/v.jpg' };
    expect(buildChatMediaAlbumMap([message('m1', [photo('1'), video])]).get('m1')?.entries).toHaveLength(2);
  });

  it('groups an in-flight send but keeps failed and cancelled ones standalone', () => {
    const pending = [photo('1'), photo('2')];
    expect(buildChatMediaAlbumMap([message('m1', pending, { local_status: 'sending' })]).size).toBe(1);
    expect(buildChatMediaAlbumMap([message('m2', pending, { local_status: 'failed' })]).size).toBe(0);
    expect(buildChatMediaAlbumMap([message('m3', pending, { local_status: 'cancelled' })]).size).toBe(0);
  });

  it('leaves forwarded, replied, deleted and non-media messages out', () => {
    const two = [photo('1'), photo('2')];
    const forwarded = message('m1', two, { forward_preview: { id: 'x', sender_name: 'А' } });
    const replied = message('m2', two, { reply_preview: { id: 'x', sender_name: 'А' } });
    const deleted = message('m3', two, { is_deleted: true });
    const withDocument = message('m4', [photo('1'), { id: 'd', kind: 'file', mime_type: 'application/pdf' }]);
    const taskShare = message('m5', two, { kind: 'task_share' });
    expect(buildChatMediaAlbumMap([forwarded, replied, deleted, withDocument, taskShare]).size).toBe(0);
  });
});
