import { disabledNativeFeatureHref } from './NativeFeatureRoute';

it('redirects a disabled native feature to the native menu', () => {
  expect(disabledNativeFeatureHref(false)).toEqual({ pathname: '/(shell)/menu' });
});

it('keeps an enabled native feature on its native route', () => {
  expect(disabledNativeFeatureHref(true)).toBeNull();
});
