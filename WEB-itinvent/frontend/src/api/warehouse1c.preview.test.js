import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: { get: vi.fn() },
}));

vi.mock('./client', () => ({ default: apiClientMock }));

import { WAREHOUSE_1C_QUERY_TIMEOUT_MS, warehouse1cAPI } from './warehouse1c';

describe('warehouse 1C movement file preview API', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { status: 'ready' } });
  });

  it('requests metadata and converted PDF with encoded file references', async () => {
    await warehouse1cAPI.getMovementFilePreview('registrar ref', 'file/ref');
    await warehouse1cAPI.downloadMovementFilePreviewPdf('registrar ref', 'file/ref');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      1,
      '/warehouse-1c/movements/files/file%2Fref/preview',
      {
        params: { registrar_ref: 'registrar ref' },
        signal: undefined,
        timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/warehouse-1c/movements/files/file%2Fref/preview/pdf',
      {
        params: { registrar_ref: 'registrar ref' },
        responseType: 'blob',
        timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      },
    );
  });
});
