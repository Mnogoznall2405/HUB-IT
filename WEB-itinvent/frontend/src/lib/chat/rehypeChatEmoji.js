import { containsEmoji, splitEmojiText } from './emojiImages';

// rehype plugin: emoji in markdown text become <chat-emoji emoji="..."> elements that the chat
// renderer maps to <ChatEmojiImage>. Run it AFTER rehype-sanitize (the element is ours and its
// only property is the original emoji string). Code stays verbatim.
const SKIP_TAGS = new Set(['code', 'pre']);

function transformChildren(node) {
  if (!Array.isArray(node.children)) return;
  if (node.type === 'element' && SKIP_TAGS.has(node.tagName)) return;
  const next = [];
  node.children.forEach((child) => {
    if (child.type === 'text' && containsEmoji(child.value)) {
      splitEmojiText(child.value).forEach((part) => {
        next.push(part.type === 'emoji'
          ? { type: 'element', tagName: 'chat-emoji', properties: { emoji: part.value }, children: [] }
          : { type: 'text', value: part.value });
      });
      return;
    }
    transformChildren(child);
    next.push(child);
  });
  // hast trees are edited in place
  node.children = next;
}

export default function rehypeChatEmoji() {
  return (tree) => {
    transformChildren(tree);
  };
}
