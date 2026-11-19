import { Redirect, useLocalSearchParams } from 'expo-router';
import { NativeFeedInboxScreen } from '../../../src/screens/feed/NativeFeedInboxScreen';

export default function ShellFeedRoute() {
  const params = useLocalSearchParams<{ post?: string | string[]; commentId?: string | string[] }>();
  const postId = String(Array.isArray(params.post) ? params.post[0] : params.post || '').trim();
  const commentId = String(
    Array.isArray(params.commentId) ? params.commentId[0] : params.commentId || '',
  ).trim();
  if (postId) {
    return (
      <Redirect
        href={{
          pathname: '/(shell)/feed/[postId]',
          params: { postId, ...(commentId ? { commentId } : {}) },
        }}
      />
    );
  }
  return <NativeFeedInboxScreen />;
}
