import {
  CHAT_GALLERY_TABS,
  chatGalleryEmptyLabel,
  chatGalleryItemLabel,
} from './chatConversationGallery';

describe('native conversation gallery helpers', () => {
  it('keeps photo, video and file tabs', () => {
    expect(CHAT_GALLERY_TABS.map((tab) => tab.key)).toEqual(['image', 'video', 'file']);
    expect(chatGalleryEmptyLabel('image')).toBe('Нет фото');
    expect(chatGalleryEmptyLabel('video')).toBe('Нет видео');
    expect(chatGalleryEmptyLabel('file')).toBe('Нет файлов');
  });

  it('names gallery items by kind', () => {
    expect(chatGalleryItemLabel({ kind: 'image', file_name: 'a.jpg' })).toBe('Открыть фото a.jpg');
    expect(chatGalleryItemLabel({ kind: 'video', file_name: 'b.mp4' })).toBe('Открыть видео b.mp4');
    expect(chatGalleryItemLabel({ kind: 'file', file_name: 'c.pdf' })).toBe('Открыть файл c.pdf');
  });
});
