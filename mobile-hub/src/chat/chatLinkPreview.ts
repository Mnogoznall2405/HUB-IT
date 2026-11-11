export const CHAT_URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

export type ChatLinkPreviewData = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
};

export function extractFirstChatUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = String(text).match(CHAT_URL_REGEX);
  return match?.[0] || null;
}

export function hasUsableLinkPreview(preview?: ChatLinkPreviewData | null): boolean {
  if (!preview) return false;
  return Boolean(preview.title || preview.image || preview.description || preview.site_name);
}
