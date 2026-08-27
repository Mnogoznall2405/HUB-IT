import {
  clampMediaZoom,
  clampMediaTranslation,
  collectThreadMedia,
  findThreadMediaIndex,
  getMediaViewerPanBounds,
  isImageChatAttachment,
  isMediaChatAttachment,
  isVideoChatAttachment,
  mediaViewerDragAxis,
  mediaItemFromConversationAttachment,
  mergeChatMediaItems,
  pickChatAttachmentPlaybackUrl,
  pickChatAttachmentOriginalUrl,
  resolveMediaViewerRelease,
  shouldPageMediaViewer,
  stepThreadMediaIndex,
} from './chatMedia';

describe('chat media helpers', () => {
  it('detects image and video attachments for the in-app viewer', () => {
    expect(isImageChatAttachment({ id: '1', kind: 'image', mime_type: 'image/jpeg' })).toBe(true);
    expect(isVideoChatAttachment({ id: '2', mime_type: 'video/mp4' })).toBe(true);
    expect(pickChatAttachmentPlaybackUrl({
      id: '2',
      download_url: '/files/clip.mp4',
      preview_url: '/files/clip.jpg',
    })).toBe('/files/clip.mp4');
    expect(pickChatAttachmentOriginalUrl({
      id: 'photo',
      original_url: '/files/photo-original.jpg',
      download_url: '/files/photo-download',
      preview_url: '/files/photo-preview.jpg',
    })).toBe('/files/photo-original.jpg');
    expect(isMediaChatAttachment({ id: '3', kind: 'file', mime_type: 'application/pdf' })).toBe(false);
    expect(isMediaChatAttachment({ id: '4', kind: 'file', mime_type: 'image/png' })).toBe(false);
    expect(isMediaChatAttachment({ id: '5', media_kind: 'file', mime_type: 'video/mp4' })).toBe(false);
    expect(isMediaChatAttachment({
      id: '6',
      kind: 'image',
      media_kind: 'file',
      mime_type: 'image/png',
    })).toBe(false);
    expect(collectThreadMedia([{
      id: 'm-audio',
      conversation_id: 'c1',
      sender_user_id: 1,
      attachments: [{ id: 'voice-1', kind: 'audio', file_name: 'voice_1.m4a', mime_type: 'audio/mp4' }],
    }])).toEqual([]);
  });

  it('collects media in thread order and pages between neighbours', () => {
    const messages = [
      {
        id: 'm2',
        conversation_id: 'c1',
        sender_user_id: 1,
        attachments: [{ id: 'a2', kind: 'image' as const }],
      },
      {
        id: 'm1',
        conversation_id: 'c1',
        sender_user_id: 2,
        attachments: [{ id: 'a1', kind: 'image' as const }],
      },
    ];
    const items = collectThreadMedia(messages);
    expect(items.map((item) => item.attachment.id)).toEqual(['a2', 'a1']);
    expect(findThreadMediaIndex(items, 'm1', 'a1')).toBe(1);
    expect(stepThreadMediaIndex(0, 'next', 2)).toBe(1);
    expect(stepThreadMediaIndex(0, 'prev', 2)).toBeNull();
    expect(shouldPageMediaViewer(-90, 10)).toBe('next');
    expect(shouldPageMediaViewer(90, 10)).toBe('prev');
    expect(shouldPageMediaViewer(-90, 100)).toBeNull();
    expect(clampMediaZoom(6)).toBe(4);
  });

  it('builds a viewer item from a conversation attachment', () => {
    const item = mediaItemFromConversationAttachment({
      id: 'a1',
      message_id: 'm1',
      kind: 'image',
      created_at: '2026-08-23T08:00:00Z',
    }, 'c1');
    expect(item.message.id).toBe('m1');
    expect(item.message.conversation_id).toBe('c1');
    expect(item.attachment.id).toBe('a1');
  });

  it('merges a paged media manifest without losing richer thread metadata', () => {
    const fromThread = mediaItemFromConversationAttachment({
      id: 'a1', message_id: 'm1', kind: 'image', created_at: '2026-08-24T10:00:00Z',
    }, 'c1');
    fromThread.message.sender = { id: 2, username: 'ivan', full_name: 'Иван' };
    const older = mediaItemFromConversationAttachment({
      id: 'a0', message_id: 'm0', kind: 'image', created_at: '2026-08-23T10:00:00Z',
    }, 'c1');
    const duplicate = mediaItemFromConversationAttachment({
      id: 'a1', message_id: 'm1', kind: 'image', created_at: '2026-08-24T10:00:00Z',
    }, 'c1');
    const result = mergeChatMediaItems([fromThread], [duplicate, older]);
    expect(result.map((item) => item.attachment.id)).toEqual(['a1', 'a0']);
    expect(result[0].message.sender?.full_name).toBe('Иван');
  });

  it('locks page and dismiss gestures before they can conflict', () => {
    expect(mediaViewerDragAxis(72, 10, 1)).toBe('page');
    expect(mediaViewerDragAxis(10, 72, 1)).toBe('dismiss');
    expect(mediaViewerDragAxis(30, 28, 1)).toBeNull();
    expect(mediaViewerDragAxis(72, 10, 2)).toBe('zoom');
  });

  it('uses distance and velocity without dismissing a zoomed photo', () => {
    const base = {
      width: 360,
      height: 780,
      canPrev: true,
      canNext: true,
    };
    expect(resolveMediaViewerRelease({ ...base, dx: -130, dy: 8, velocityX: 0, velocityY: 0, scale: 1 }))
      .toBe('next');
    expect(resolveMediaViewerRelease({ ...base, dx: 12, dy: 150, velocityX: 0, velocityY: 0, scale: 1 }))
      .toBe('dismiss');
    expect(resolveMediaViewerRelease({ ...base, dx: 12, dy: 200, velocityX: 0, velocityY: 900, scale: 2 }))
      .toBe('settle');
    expect(resolveMediaViewerRelease({ ...base, dx: -30, dy: 2, velocityX: -700, velocityY: 0, scale: 1 }))
      .toBe('next');
    expect(resolveMediaViewerRelease({ ...base, canNext: false, dx: -180, dy: 2, velocityX: 0, velocityY: 0, scale: 1 }))
      .toBe('settle');
  });

  it('clamps an enlarged image to its fitted viewport bounds', () => {
    const portrait = getMediaViewerPanBounds({
      viewportWidth: 360,
      viewportHeight: 720,
      mediaWidth: 1200,
      mediaHeight: 1600,
      scale: 3,
    });
    expect(portrait.x).toBeCloseTo(360);
    expect(portrait.y).toBeCloseTo(360);
    expect(clampMediaTranslation(900, portrait.x)).toBeCloseTo(360);
    expect(clampMediaTranslation(-500, portrait.y)).toBeCloseTo(-360);
  });
});
