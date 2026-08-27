import {
  computersPortalPath,
  nativeComputersDestinationFromPortalPath,
  resolveNativeComputersEnabled,
} from './nativeComputersFeature';

it('keeps Native Computers behind an explicit canary flag', () => {
  expect(resolveNativeComputersEnabled(undefined)).toBe(false);
  expect(resolveNativeComputersEnabled('false')).toBe(false);
  expect(resolveNativeComputersEnabled('true')).toBe(true);
});

it('maps only the confirmed Computers root and single q query', () => {
  expect(nativeComputersDestinationFromPortalPath('/computers')).toEqual({ pathname: '/(shell)/computers' });
  expect(nativeComputersDestinationFromPortalPath('/computers/?q=  PC-01  ')).toEqual({
    pathname: '/(shell)/computers',
    params: { q: 'PC-01' },
  });
  expect(nativeComputersDestinationFromPortalPath('/computers?status=online')).toBeNull();
  expect(nativeComputersDestinationFromPortalPath('/computers?q=a&q=b')).toBeNull();
  expect(nativeComputersDestinationFromPortalPath('/computers#detail')).toBeNull();
  expect(nativeComputersDestinationFromPortalPath('/computers/AA-BB')).toBeNull();
});

it('builds the canonical web fallback without leaking internal native detail routes', () => {
  expect(computersPortalPath()).toBe('/computers');
  expect(computersPortalPath({ q: ' PC 01 ' })).toBe('/computers?q=PC%2001');
});
