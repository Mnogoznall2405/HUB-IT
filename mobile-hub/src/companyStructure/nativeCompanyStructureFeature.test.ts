import {
  companyStructurePortalPath,
  nativeCompanyStructureDestinationFromPortalPath,
  resolveNativeCompanyStructureEnabled,
} from './nativeCompanyStructureFeature';

it('keeps the native feature enabled unless explicitly disabled', () => {
  expect(resolveNativeCompanyStructureEnabled(undefined)).toBe(true);
  expect(resolveNativeCompanyStructureEnabled('true')).toBe(true);
  expect(resolveNativeCompanyStructureEnabled('false')).toBe(false);
});

it('maps only the safe root route and preserves node and block context', () => {
  expect(nativeCompanyStructureDestinationFromPortalPath('/company-structure?node=dep%2F1&block=block-1&view=focus')).toEqual({
    pathname: '/(shell)/company-structure',
    params: { nodeId: 'dep/1', blockId: 'block-1' },
  });
  expect(nativeCompanyStructureDestinationFromPortalPath('/company-structure?view=chart')).toEqual({
    pathname: '/(shell)/company-structure',
  });
  expect(nativeCompanyStructureDestinationFromPortalPath('/company-structure?admin=1')).toBeNull();
  expect(nativeCompanyStructureDestinationFromPortalPath('/company-structure/edit')).toBeNull();
  expect(nativeCompanyStructureDestinationFromPortalPath('/company-structure#node')).toBeNull();
});

it('builds the exact focus-mode portal fallback', () => {
  expect(companyStructurePortalPath({ nodeId: 'dep/1', blockId: 'block-1' }))
    .toBe('/company-structure?node=dep%2F1&block=block-1&view=focus');
});

