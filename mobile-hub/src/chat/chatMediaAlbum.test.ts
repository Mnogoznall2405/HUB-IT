import type { ChatMessage } from '../api/types';
import { buildChatMediaAlbumMap } from './chatMediaAlbum';

function photoMessage(id: string, sender = 7, at = '2026-09-25T10:00:00Z'): ChatMessage {
  return {
    id,
    kind: 'text',
    body_text: '',
    sender_user_id: sender,
    created_at: at,
    attachments: [{ id: `a-${id}`, kind: 'image', mime_type: 'image/jpeg', preview_url: 'https://x/p.jpg' }],
  } as ChatMessage;
}

describe('buildChatMediaAlbumMap', () => {
  it('groups consecutive photo-only messages of one sender', () => {
    const map = buildChatMediaAlbumMap([
      photoMessage('m3', 7, '2026-09-25T10:00:30Z'),
      photoMessage('m2', 7, '2026-09-25T10:00:20Z'),
      photoMessage('m1', 7, '2026-09-25T10:00:00Z'),
    ]);
    expect(map.get('m1')?.headId).toBe('m1');
    expect(map.get('m2')?.headId).toBe('m1');
    expect(map.get('m3')?.headId).toBe('m1');
    expect(map.get('m1')?.entries).toHaveLength(3);
  });

  it('does not group different senders', () => {
    const map = buildChatMediaAlbumMap([
      photoMessage('m2', 8),
      photoMessage('m1', 7),
    ]);
    expect(map.size).toBe(0);
  });

  it('merges a captioned member and exposes its caption (DEV-MEDIA-3)', () => {
    const captioned = photoMessage('m2', 7, '2026-09-25T10:00:20Z');
    captioned.body_text = 'смотри';
    const map = buildChatMediaAlbumMap([
      photoMessage('m3', 7, '2026-09-25T10:00:30Z'),
      captioned,
      photoMessage('m1', 7, '2026-09-25T10:00:00Z'),
    ]);
    expect(map.get('m1')?.headId).toBe('m1');
    expect(map.get('m1')?.caption).toBe('смотри');
    expect(map.get('m1')?.entries).toHaveLength(3);
  });

  it('accepts video attachments into the album (DEV-MEDIA-3)', () => {
    const video = photoMessage('m2', 7, '2026-09-25T10:00:20Z');
    video.attachments = [{ id: 'v-1', kind: 'video', mime_type: 'video/mp4', preview_url: 'https://x/v.jpg' }];
    const map = buildChatMediaAlbumMap([video, photoMessage('m1')]);
    expect(map.get('m1')?.entries).toHaveLength(2);
  });

  it('groups in-flight photo sends, but keeps failed/cancelled out (DEV-MEDIA-3)', () => {
    const sending = photoMessage('m2', 7, '2026-09-25T10:00:20Z');
    sending.local_status = 'sending';
    sending.attachments = [{ id: 'a-m2', kind: 'image', mime_type: 'image/jpeg', local_uri: 'file:///tmp/m2.jpg' }];
    const map = buildChatMediaAlbumMap([
      photoMessage('m3', 7, '2026-09-25T10:00:30Z'),
      sending,
      photoMessage('m1', 7, '2026-09-25T10:00:00Z'),
    ]);
    expect(map.get('m1')?.entries).toHaveLength(3);

    const failed = photoMessage('m2f', 7, '2026-09-25T10:00:20Z');
    failed.local_status = 'failed';
    const failedMap = buildChatMediaAlbumMap([
      photoMessage('m3f', 7, '2026-09-25T10:00:30Z'),
      failed,
      photoMessage('m1f', 7, '2026-09-25T10:00:00Z'),
    ]);
    expect(failedMap.size).toBe(0);
  });

  it('does not group a single photo message', () => {
    const map = buildChatMediaAlbumMap([photoMessage('m1')]);
    expect(map.size).toBe(0);
  });

  it('includes multiple attachments of one message in the album', () => {
    const multi = photoMessage('m1');
    multi.attachments = [
      { id: 'a-1', kind: 'image', mime_type: 'image/png', preview_url: 'https://x/1.png' },
      { id: 'a-2', kind: 'image', mime_type: 'image/png', preview_url: 'https://x/2.png' },
    ];
    const map = buildChatMediaAlbumMap([photoMessage('m2'), multi]);
    expect(map.get('m1')?.entries).toHaveLength(3);
  });
});
