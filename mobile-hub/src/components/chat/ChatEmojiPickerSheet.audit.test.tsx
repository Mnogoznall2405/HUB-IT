import { act, fireEvent, render } from '@testing-library/react-native';
import { fetchChatGifs, type ChatGifItem } from '../../chat/chatGiphy';
import { ChatEmojiPickerSheet } from './ChatEmojiPickerSheet';

jest.mock('../../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('../../chat/chatGiphy', () => ({
  fetchChatGifs: jest.fn(),
}));

const mockFetchGifs = jest.mocked(fetchChatGifs);

const gif = (id: string): ChatGifItem => ({
  id,
  title: id,
  previewUrl: `https://media.test/${id}-preview.gif`,
  fullUrl: `https://media.test/${id}.gif`,
});

const sheet = () => (
  <ChatEmojiPickerSheet
    visible
    onClose={jest.fn()}
    onSelect={jest.fn()}
    onSelectGif={jest.fn()}
  />
);

afterEach(() => {
  jest.useRealTimers();
});

describe('AUD-5 gif request generation', () => {
  it('shows only the latest response when an earlier request resolves late', async () => {
    jest.useFakeTimers();
    let resolveStale: (items: ChatGifItem[]) => void = () => {};
    let resolveFresh: (items: ChatGifItem[]) => void = () => {};
    mockFetchGifs
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));

    const view = await render(sheet());
    await act(async () => {
      await fireEvent.press(view.getByLabelText('GIF'));
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(mockFetchGifs).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Поиск GIF'), 'кот');
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
    expect(mockFetchGifs).toHaveBeenCalledTimes(2);
    expect(mockFetchGifs).toHaveBeenLastCalledWith('search', 'кот');

    // The newer request resolves first — its result is rendered.
    await act(async () => { resolveFresh([gif('fresh')]); });
    expect(view.getByLabelText('Отправить GIF fresh')).toBeTruthy();

    // The stale response arrives afterwards and must be dropped.
    await act(async () => { resolveStale([gif('stale')]); });
    expect(view.queryByLabelText('Отправить GIF stale')).toBeNull();
    expect(view.getByLabelText('Отправить GIF fresh')).toBeTruthy();
  });

  it('surfaces an error state when the request fails instead of spinning forever', async () => {
    jest.useFakeTimers();
    mockFetchGifs.mockRejectedValue(new Error('media panel timeout'));
    const view = await render(sheet());
    await act(async () => {
      await fireEvent.press(view.getByLabelText('GIF'));
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });

    expect(view.getByText('Не удалось загрузить GIF')).toBeTruthy();
  });
});
