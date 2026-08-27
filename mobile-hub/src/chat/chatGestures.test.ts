import {
  folderSwipeDirection,
  nextChatThreadBackAction,
  inboxRowSwipeAction,
  nextInboxRowSettings,
  shouldDismissMediaViewer,
  shouldEngageEdgeBackSwipe,
  shouldKeepHorizontalSwipe,
  shouldStartInboxRowSwipe,
  shouldLockInboxRefresh,
  shouldStartFolderSwipe,
  shouldTrackEdgeBackSwipe,
  shouldTriggerEdgeBackSwipe,
  shouldTriggerFolderSwipe,
} from './chatGestures';

describe('native chat gesture thresholds', () => {
  it('keeps back swipe on the left edge so reply swipe still owns the bubble', () => {
    expect(shouldTrackEdgeBackSwipe(0)).toBe(true);
    expect(shouldTrackEdgeBackSwipe(16)).toBe(true);
    expect(shouldTrackEdgeBackSwipe(17)).toBe(false);
    expect(shouldEngageEdgeBackSwipe(18, 2)).toBe(true);
    expect(shouldEngageEdgeBackSwipe(8, 1)).toBe(false);
    expect(shouldEngageEdgeBackSwipe(40, 50)).toBe(false);
    expect(shouldTriggerEdgeBackSwipe(83, true)).toBe(false);
    expect(shouldTriggerEdgeBackSwipe(84, true)).toBe(true);
    expect(shouldTriggerEdgeBackSwipe(120, false)).toBe(false);
    expect(shouldKeepHorizontalSwipe(20, 8)).toBe(true);
    expect(shouldKeepHorizontalSwipe(6, 2)).toBe(false);
    expect(shouldKeepHorizontalSwipe(12, 20)).toBe(false);
  });

  it('switches folders only for a deliberate horizontal swipe', () => {
    expect(shouldStartFolderSwipe(-18, 2)).toBe(true);
    expect(shouldStartFolderSwipe(8, 1)).toBe(false);
    expect(shouldStartFolderSwipe(-40, 48)).toBe(false);
    expect(shouldTriggerFolderSwipe(-79)).toBe(false);
    expect(shouldTriggerFolderSwipe(-80)).toBe(true);
    expect(folderSwipeDirection(-90)).toBe('next');
    expect(folderSwipeDirection(90)).toBe('prev');
    expect(shouldLockInboxRefresh(-10, 4)).toBe(true);
    expect(shouldLockInboxRefresh(-4, 12)).toBe(false);
  });

  it('closes the media viewer on a downward swipe', () => {
    expect(shouldDismissMediaViewer(10, 80)).toBe(true);
    expect(shouldDismissMediaViewer(90, 80)).toBe(false);
    expect(shouldDismissMediaViewer(0, 40)).toBe(false);
  });

  it('closes chat layers from top to inbox', () => {
    expect(nextChatThreadBackAction({ viewer: true, selection: true })).toBe('viewer');
    expect(nextChatThreadBackAction({ sheet: true, search: true })).toBe('sheet');
    expect(nextChatThreadBackAction({ search: true, selection: true })).toBe('search');
    expect(nextChatThreadBackAction({ selection: true })).toBe('selection');
    expect(nextChatThreadBackAction({ voice: true, sheet: true })).toBe('voice');
    expect(nextChatThreadBackAction({})).toBe('inbox');
  });

  it('archives left and mutes right on an inbox row swipe', () => {
    expect(shouldStartInboxRowSwipe(-24, 4)).toBe(true);
    expect(shouldStartInboxRowSwipe(-8, 2)).toBe(false);
    expect(inboxRowSwipeAction(-72)).toBe('archive');
    expect(inboxRowSwipeAction(72)).toBe('mute');
    expect(inboxRowSwipeAction(20)).toBeNull();
    expect(nextInboxRowSettings({ is_muted: false }, 'mute')).toEqual({ is_muted: true });
    expect(nextInboxRowSettings({ is_archived: true }, 'archive')).toEqual({ is_archived: false });
  });
});
