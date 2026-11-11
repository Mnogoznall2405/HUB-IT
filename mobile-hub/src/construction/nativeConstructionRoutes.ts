import type { ConstructionScope } from '../api/constructionApi';

export type NativeConstructionDestination = { pathname: '/(shell)/construction'; params?: ConstructionScope };
export function constructionHref(params: ConstructionScope = {}): NativeConstructionDestination {
  return { pathname: '/(shell)/construction', params };
}
export function nativeConstructionDestinationFromPortalPath(path: string): NativeConstructionDestination | null {
  try {
    const url = new URL(path, 'https://hubit.invalid');
    if (url.hash) return null;
    const match = url.pathname.match(/^\/construction(?:\/objects\/([^/]+)(?:\/directions\/([^/]+))?(?:\/requests\/([^/]+))?)?\/?$/);
    if (!match) return null;
    const values = match.slice(1).map(value => value ? decodeURIComponent(value) : undefined);
    if (values.some(value => value && (value.length > 256 || /[\/\\\u0000-\u001f]/.test(value)))) return null;
    return constructionHref({ objectId: values[0], groupRef: values[1], requestRef: values[2],
      ...(values[0] && !values[2] && url.searchParams.get('tab') === 'work' ? { tab: 'work' as const } : {}),
    });
  } catch { return null; }
}
