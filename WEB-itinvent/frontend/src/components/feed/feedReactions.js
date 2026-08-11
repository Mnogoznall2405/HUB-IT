export const FEED_REACTIONS = [
  { id: 'like', emoji: '👍', label: 'Нравится' },
  { id: 'love', emoji: '❤️', label: 'Любовь' },
  { id: 'laugh', emoji: '😂', label: 'Смех' },
  { id: 'wow', emoji: '😮', label: 'Удивление' },
  { id: 'sad', emoji: '😢', label: 'Грусть' },
  { id: 'angry', emoji: '😡', label: 'Возмущение' },
];

export const getFeedReaction = (reactionType) => (
  FEED_REACTIONS.find((reaction) => reaction.id === reactionType) || null
);

export const getFeedReactionGroups = (counts) => FEED_REACTIONS
  .map((reaction) => ({
    ...reaction,
    count: Math.max(0, Number(counts?.[reaction.id] || 0)),
  }))
  .filter((reaction) => reaction.count > 0);
