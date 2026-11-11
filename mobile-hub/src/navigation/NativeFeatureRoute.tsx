import { Redirect, type Href } from 'expo-router';
import type { ReactNode } from 'react';

export function disabledNativeFeatureHref(enabled: boolean): Href | null {
  if (enabled) return null;
  return { pathname: '/(shell)/menu' } as Href;
}

export function NativeFeatureRoute({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const fallback = disabledNativeFeatureHref(enabled);
  if (fallback) return <Redirect href={fallback} />;
  return children;
}
