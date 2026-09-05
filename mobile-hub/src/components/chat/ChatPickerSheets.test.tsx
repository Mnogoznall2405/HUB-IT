import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ChatStickerPack } from '../../api/types';
import { CHAT_EMOJI_GROUPS } from '../../chat/chatEmoji';
import { ChatEmojiPickerSheet } from './ChatEmojiPickerSheet';
import { ChatStickerPickerSheet } from './ChatStickerPickerSheet';

jest.mock('./ChatStickerImage', () => ({
  ChatStickerImage: () => {
    const ReactModule = require('react');
    const { View: NativeView } = require('react-native');
    return ReactModule.createElement(NativeView, { testID: 'sticker-thumbnail' });
  },
}));

describe('native chat picker virtualization', () => {
  it('renders emoji rows in bounded batches instead of mounting the full catalog', async () => {
    const view = await render(
      <ChatEmojiPickerSheet visible onClose={jest.fn()} onSelect={jest.fn()} />,
    );
    const list = view.getByTestId('chat-emoji-picker-list');
    const emojiCount = CHAT_EMOJI_GROUPS.reduce((sum, group) => sum + group.emojis.length, 0);

    expect(list.props.initialNumToRender).toBe(6);
    expect(list.props.maxToRenderPerBatch).toBe(6);
    expect(list.props.data.length).toBeLessThan(emojiCount);
    expect(view.getAllByRole('button').length).toBeLessThan(emojiCount);
  });

  it('mounts only the first sticker rows for large installed packs', async () => {
    const packs: ChatStickerPack[] = Array.from({ length: 4 }, (_, packIndex) => ({
      id: `pack-${packIndex}`,
      short_name: `pack-${packIndex}`,
      title: `Pack ${packIndex}`,
      stickers: Array.from({ length: 80 }, (_, stickerIndex) => ({
        id: `sticker-${packIndex}-${stickerIndex}`,
        preview_url: `/stickers/${packIndex}/${stickerIndex}/preview`,
      })),
    }));
    const view = await render(
      <ChatStickerPickerSheet
        visible
        packs={packs}
        onClose={jest.fn()}
        onSend={jest.fn()}
      />,
    );
    const list = view.getByTestId('chat-sticker-picker-list');

    expect(list.props.initialNumToRender).toBe(6);
    expect(list.props.maxToRenderPerBatch).toBe(5);
    expect(list.props.data).toHaveLength(84);
    expect(view.queryAllByTestId('sticker-thumbnail')).toHaveLength(20);
  });
});
