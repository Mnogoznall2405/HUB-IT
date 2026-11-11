import { memo, useState } from 'react';
import { emojiImageCandidates, emojiImageUrl, splitEmojiText } from '../../lib/chat/emojiImages';

// R48: Apple emoji drawn as images. Size follows the surrounding text (em), so the same
// component serves message text, previews and reactions; `size` overrides it (px or css).
const EMOJI_IMAGE_STYLE = {
  display: 'inline-block',
  width: '1.22em',
  height: '1.22em',
  margin: '0 0.04em',
  verticalAlign: '-0.26em',
  objectFit: 'contain',
  // No user-select:none: a selected image must still copy as its alt (the real character).
  pointerEvents: 'none',
};

export const ChatEmojiImage = memo(function ChatEmojiImage({ emoji, size, style }) {
  const candidates = emojiImageCandidates(emoji);
  // Failed attempts belong to one emoji; a new emoji in the same slot starts from the first candidate.
  const [failed, setFailed] = useState({ emoji: '', count: 0 });
  const attempt = failed.emoji === emoji ? failed.count : 0;
  if (!candidates.length || attempt >= candidates.length) {
    // No image for this sequence: show the platform glyph instead of a broken picture.
    return <span data-chat-emoji-native="true" style={style}>{emoji}</span>;
  }
  return (
    <img
      className="chat-emoji"
      data-chat-emoji="true"
      src={emojiImageUrl(candidates[attempt])}
      alt={emoji}
      draggable={false}
      onError={() => setFailed({ emoji, count: attempt + 1 })}
      style={{
        ...EMOJI_IMAGE_STYLE,
        ...(size ? { width: size, height: size } : null),
        ...style,
      }}
    />
  );
});

// string -> string (untouched when there is no emoji) | array of strings and <ChatEmojiImage>.
export function renderChatEmojiText(value, imageProps, keyPrefix = '') {
  const text = String(value ?? '');
  const parts = splitEmojiText(text);
  if (!parts.some((part) => part.type === 'emoji')) return text;
  return parts.map((part, index) => (
    part.type === 'emoji'
      ? <ChatEmojiImage key={`${keyPrefix}e${index}`} emoji={part.value} {...imageProps} />
      : part.value
  ));
}

export default ChatEmojiImage;
