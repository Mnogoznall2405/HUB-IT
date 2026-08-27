import {
  nativeDatabaseDestinationFromPortalPath,
  nativeEquipmentDestination,
  resolveNativeDatabaseEnabled,
} from './nativeDatabaseFeature';

describe('nativeDatabaseDestinationFromPortalPath', () => {
  it('maps the search list and native-safe detail parameters', () => {
    expect(nativeDatabaseDestinationFromPortalPath('/database?q=printer&mode=acts')).toEqual({
      pathname: '/(shell)/database',
      params: { q: 'printer', mode: 'acts' },
    });
    expect(nativeDatabaseDestinationFromPortalPath('/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT&tab=history')).toEqual({
      pathname: '/(shell)/database/[invNo]',
      params: { invNo: 'INV/7', databaseId: 'OBJ-ITINVENT', tab: 'history' },
    });
    expect(nativeDatabaseDestinationFromPortalPath('/database?mode=consumables&q=12A')).toEqual({
      pathname: '/(shell)/database',
      params: { q: '12A', mode: 'consumables' },
    });
    expect(nativeDatabaseDestinationFromPortalPath('/database?inv_no=INV-9&tab=works')).toEqual({
      pathname: '/(shell)/database/[invNo]',
      params: { invNo: 'INV-9', tab: 'works' },
    });
  });

  it('rejects unsupported upload, reminder and unknown workflows', () => {
    expect(nativeDatabaseDestinationFromPortalPath('/database?upload_act=1&reminder_id=r1&source_task_id=t1')).toBeNull();
    expect(nativeDatabaseDestinationFromPortalPath('/database?scan=1')).toBeNull();
    expect(nativeDatabaseDestinationFromPortalPath('/database?mode=write')).toBeNull();
    expect(nativeDatabaseDestinationFromPortalPath('/database?tab=warehouse1c')).toBeNull();
    expect(nativeDatabaseDestinationFromPortalPath('/database/consumables')).toBeNull();
  });

  it('rejects overlong native identifiers', () => {
    expect(nativeDatabaseDestinationFromPortalPath(`/database?inv_no=${'x'.repeat(201)}`)).toBeNull();
  });
});

it('builds an internal native equipment destination', () => {
  expect(nativeEquipmentDestination('INV/7', 'acts', 'OBJ-ITINVENT')).toEqual({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV/7', databaseId: 'OBJ-ITINVENT', tab: 'acts' },
  });
});

it('keeps native Database default-on with an explicit rollback flag', () => {
  expect(resolveNativeDatabaseEnabled(undefined)).toBe(true);
  expect(resolveNativeDatabaseEnabled('true')).toBe(true);
  expect(resolveNativeDatabaseEnabled('false')).toBe(false);
});
