import { Box } from '@mui/material';

export const CHAT_URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

const CHAT_PLAIN_TEXT_TOKEN_REGEX = /(@[0-9A-Za-zА-Яа-яЁё_.-]+|https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*))/gi;

export function extractFirstChatUrl(text) {
  if (!text) return null;
  const match = String(text).match(CHAT_URL_REGEX);
  return match ? match[0] : null;
}

export function renderChatPlainTextBody(value, { mentionColor, linkColor } = {}) {
  const text = String(value || '');
  if (!text) return text;
  if (!text.includes('@') && !/https?:\/\//i.test(text)) return text;

  const parts = [];
  let lastIndex = 0;
  let matchIndex = 0;
  const pattern = new RegExp(CHAT_PLAIN_TEXT_TOKEN_REGEX.source, CHAT_PLAIN_TEXT_TOKEN_REGEX.flags);

  text.replace(pattern, (token, _capture, offset) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset));
    }
    if (token.startsWith('@')) {
      parts.push(
        <Box
          key={`mention-${offset}-${matchIndex}`}
          component="span"
          sx={{ color: mentionColor, fontWeight: 800 }}
        >
          {token}
        </Box>,
      );
    } else {
      parts.push(
        <Box
          key={`url-${offset}-${matchIndex}`}
          component="a"
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            color: linkColor,
            textDecoration: 'underline',
            textUnderlineOffset: '0.14em',
            wordBreak: 'break-word',
          }}
        >
          {token}
        </Box>,
      );
    }
    lastIndex = offset + token.length;
    matchIndex += 1;
    return token;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
