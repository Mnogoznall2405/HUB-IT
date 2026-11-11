import { describe, expect, it, vi } from 'vitest';

import { loadWarehouseMovementFilePreview } from './warehouse1cMovementFilePreview';

describe('warehouse 1C movement file preview', () => {
  it('opens PNG attachments as images instead of reporting PDF-only preview', async () => {
    const pngBlob = new Blob(['png'], { type: 'image/png' });
    const api = {
      downloadMovementFile: vi.fn().mockResolvedValue({
        data: pngBlob,
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'attachment; filename="scan.png"',
        },
      }),
      getMovementFilePreview: vi.fn(),
      downloadMovementFilePreviewPdf: vi.fn(),
    };
    const createObjectUrl = vi.fn().mockReturnValue('blob:warehouse-image');

    const preview = await loadWarehouseMovementFilePreview({
      registrarRef: 'registrar-1',
      file: { ref: 'file-1', name: 'scan.png' },
      api,
      createObjectUrl,
    });

    expect(preview).toMatchObject({
      kind: 'image',
      filename: 'scan.png',
      objectUrl: 'blob:warehouse-image',
      blob: pngBlob,
    });
    expect(api.downloadMovementFile).toHaveBeenCalledWith('registrar-1', 'file-1');
    expect(api.getMovementFilePreview).not.toHaveBeenCalled();
  });

  it('uses the asynchronous Office-to-PDF preview for DOCX attachments', async () => {
    const pdfBlob = new Blob(['%PDF-preview'], { type: 'application/pdf' });
    const api = {
      downloadMovementFile: vi.fn(),
      getMovementFilePreview: vi.fn().mockResolvedValue({
        status: 'ready',
        preview_kind: 'office_pdf',
        source_kind: 'word',
        pdf_filename: 'act.pdf',
        page_count: 3,
        sheets: [],
      }),
      downloadMovementFilePreviewPdf: vi.fn().mockResolvedValue({
        data: pdfBlob,
        headers: { 'content-type': 'application/pdf' },
      }),
    };

    const preview = await loadWarehouseMovementFilePreview({
      registrarRef: 'registrar-1',
      file: { ref: 'file-2', name: 'act.docx' },
      api,
      createObjectUrl: vi.fn().mockReturnValue('blob:warehouse-office-pdf'),
    });

    expect(preview).toMatchObject({
      kind: 'office_pdf',
      sourceKind: 'word',
      filename: 'act.docx',
      pdfFilename: 'act.pdf',
      pageCount: 3,
      objectUrl: 'blob:warehouse-office-pdf',
      previewBlob: pdfBlob,
    });
    expect(api.getMovementFilePreview).toHaveBeenCalledWith(
      'registrar-1',
      'file-2',
      { signal: expect.anything() },
    );
    expect(api.downloadMovementFilePreviewPdf).toHaveBeenCalledWith('registrar-1', 'file-2');
    expect(api.downloadMovementFile).not.toHaveBeenCalled();
  });
});
