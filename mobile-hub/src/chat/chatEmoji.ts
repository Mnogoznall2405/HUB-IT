export type ChatEmojiGroup = {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
};

export const CHAT_EMOJI_GROUPS: ChatEmojiGroup[] = [
  {
    id: 'smileys',
    name: 'Смайлы',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '🥹', '😅', '🤣', '😂', '🙂', '😉', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜',
      '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑',
      '😶', '🫥', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴',
      '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳',
      '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '😮', '😯', '😲', '😳',
      '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀',
      '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖',
    ],
  },
  {
    id: 'gestures',
    name: 'Жесты',
    icon: '👍',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟',
      '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '🫵', '👍', '👎', '✊', '👊',
      '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '💪', '👀', '✍️',
    ],
  },
  {
    id: 'hearts',
    name: 'Сердца',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💋', '🔥', '✨',
      '🎉', '✅', '❗', '💯',
    ],
  },
  {
    id: 'animals',
    name: 'Животные',
    icon: '🐱',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
      '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤',
      '🦆', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🦋', '🐞', '🐢', '🐍',
    ],
  },
  {
    id: 'food',
    name: 'Еда',
    icon: '🍕',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒',
      '🍑', '🥭', '🍍', '🥝', '🍅', '🥑', '🥦', '🌶️', '🌽', '🥕', '🍞',
      '🧀', '🍕', '🍔', '🍟', '🌭', '🍿', '🥚', '🍳', '🥞', '🥓', '🍗',
    ],
  },
];

export function filterEmojiGroups(query: string, groups = CHAT_EMOJI_GROUPS): ChatEmojiGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return groups;
  return groups
    .map((group) => {
      const nameMatch = group.name.toLowerCase().includes(normalized)
        || group.id.toLowerCase().includes(normalized);
      return {
        ...group,
        emojis: nameMatch ? group.emojis : group.emojis.filter((emoji) => emoji.includes(normalized)),
      };
    })
    .filter((group) => group.emojis.length > 0);
}
