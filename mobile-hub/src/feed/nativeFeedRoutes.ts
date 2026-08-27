export type NativeFeedDestination =
  | { pathname: '/(shell)/feed' }
  | {
      pathname: '/(shell)/feed/[postId]';
      params: { postId: string; commentId?: string };
    };

export function nativeFeedDestinationFromPortalPath(path: string): NativeFeedDestination | null {
  const raw = String(path || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://hubit.invalid' || parsed.pathname !== '/feed') return null;

  const postId = String(
    parsed.searchParams.get('post')
      || parsed.searchParams.get('announcement')
      || '',
  ).trim();
  if (!postId) return { pathname: '/(shell)/feed' };

  const hash = String(parsed.hash || '').replace(/^#/, '');
  const commentMatch = hash.match(/^feed-comment-(.+)$/i);
  const commentId = String(
    parsed.searchParams.get('comment')
      || parsed.searchParams.get('comment_id')
      || commentMatch?.[1]
      || '',
  ).trim();

  return {
    pathname: '/(shell)/feed/[postId]',
    params: {
      postId,
      ...(commentId ? { commentId } : {}),
    },
  };
}
