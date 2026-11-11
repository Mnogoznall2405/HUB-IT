import { normalizeNativeRoutePath } from './nativeRoutePath';

it('keeps trusted in-app paths and rejects API or external targets', () => {
  expect(normalizeNativeRoutePath('/chat?conversation=1')).toBe('/chat?conversation=1');
  expect(normalizeNativeRoutePath('/api/v1/auth/me')).toBe('/dashboard');
  expect(normalizeNativeRoutePath('//evil.example/path')).toBe('/dashboard');
  expect(normalizeNativeRoutePath('https://evil.example/path')).toBe('/dashboard');
});
