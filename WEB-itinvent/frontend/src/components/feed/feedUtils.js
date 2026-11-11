export const formatFeedDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getFeedInitials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('ru-RU') || '').join('') || '?';
};

export const stripFeedMarkdown = (value) => String(value || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*>\s?/gm, '')
  .replace(/[*_~]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const buildFeedPostPath = (postId) => `/feed?post=${encodeURIComponent(String(postId || ''))}`;

export const buildFeedShareMessage = (post, url) => {
  const title = String(post?.title || 'Публикация в ленте').trim();
  const preview = String(post?.preview || stripFeedMarkdown(post?.body) || '').trim();
  return [title, preview, String(url || '').trim()].filter(Boolean).join('\n\n');
};

