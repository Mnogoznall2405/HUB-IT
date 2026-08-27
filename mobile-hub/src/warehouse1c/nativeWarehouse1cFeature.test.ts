import {
  nativeWarehouse1CDestinationFromPortalPath,
  resolveNativeWarehouse1CEnabled,
  warehouse1CPortalPath,
} from './nativeWarehouse1cFeature';

it('keeps Native Warehouse 1C behind an explicit canary flag', () => {
  expect(resolveNativeWarehouse1CEnabled(undefined)).toBe(false);
  expect(resolveNativeWarehouse1CEnabled('false')).toBe(false);
  expect(resolveNativeWarehouse1CEnabled('true')).toBe(true);
});

it('maps only the exact public root', () => {
  expect(nativeWarehouse1CDestinationFromPortalPath('/warehouse-1c')).toEqual({ pathname: '/(shell)/warehouse-1c' });
  expect(nativeWarehouse1CDestinationFromPortalPath('/warehouse-1c/')).toEqual({ pathname: '/(shell)/warehouse-1c' });
  expect(nativeWarehouse1CDestinationFromPortalPath('/warehouse-1c?warehouseRef=private-ref')).toBeNull();
  expect(nativeWarehouse1CDestinationFromPortalPath('/warehouse-1c/movements')).toBeNull();
  expect(nativeWarehouse1CDestinationFromPortalPath('/warehouse-1c#balances')).toBeNull();
});

it('builds a web fallback without putting catalog names into the URL', () => {
  expect(warehouse1CPortalPath()).toBe('/warehouse-1c');
  expect(warehouse1CPortalPath({ kind: 'nomenclature', ref: 'nom/1' })).toBe('/warehouse-1c?nomenclatureRef=nom%2F1');
  expect(warehouse1CPortalPath({ kind: 'warehouses', ref: 'warehouse-1' })).toBe('/warehouse-1c?warehouseRef=warehouse-1');
});
