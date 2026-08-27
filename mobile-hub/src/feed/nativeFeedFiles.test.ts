import { FEED_FILE_MAX_BYTES } from './nativeFeedFiles';
import { buildFeedAttachmentUrl, buildFeedCommentAttachmentUrl } from '../api/feedApi';

jest.mock('../api/config', () => ({
  API_V1_BASE: 'https://hubit.zsgp.ru/api/v1',
  HUB_WEB_ORIGIN: 'https://hubit.zsgp.ru',
}));

it('keeps the native feed limit aligned with the backend contract', () => {
  expect(FEED_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
});

it('builds encoded publication and comment attachment urls', () => {
  expect(buildFeedAttachmentUrl('post/1', 'file 2')).toBe(
    'https://hubit.zsgp.ru/api/v1/hub/announcements/post%2F1/attachments/file%202/file',
  );
  expect(buildFeedCommentAttachmentUrl('post/1', 'comment 2', 'file/3')).toBe(
    'https://hubit.zsgp.ru/api/v1/hub/announcements/post%2F1/comments/comment%202/attachments/file%2F3/file',
  );
});
