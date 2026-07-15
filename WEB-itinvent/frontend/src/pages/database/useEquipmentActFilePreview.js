import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentTransferActsAPI } from '../../api/equipmentTransferActs';
import {
  fileNameFromContentDisposition,
  resolveDocumentPreviewKind,
  sniffBlobKind,
} from '../../lib/documentPreviewKind';
import { normalizeDbId, readFirst, toNumberOrNull } from './databaseRecordModel';

export const ACT_DOC_NO_ERROR = 'У акта отсутствует DOC_NO, открыть файл невозможно.';
const ACT_OPEN_ERROR = 'Не удалось открыть файл акта.';

const createEmptyPreviewState = () => ({
  open: false,
  loading: false,
  error: '',
  title: '',
  subtitle: '',
  kind: 'pdf',
  objectUrl: '',
  previewBlob: null,
});

export function useEquipmentActFilePreview({ fallbackInvNo = '' } = {}) {
  const [preview, setPreview] = useState(createEmptyPreviewState);
  const [openingDocNo, setOpeningDocNo] = useState('');
  const objectUrlRef = useRef('');

  const revokePreviewUrl = useCallback(() => {
    if (objectUrlRef.current && typeof window !== 'undefined' && window.URL?.revokeObjectURL) {
      window.URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = '';
  }, []);

  const closePreview = useCallback(() => {
    revokePreviewUrl();
    setPreview(createEmptyPreviewState());
    setOpeningDocNo('');
  }, [revokePreviewUrl]);

  useEffect(() => () => {
    revokePreviewUrl();
  }, [revokePreviewUrl]);

  const openActFile = useCallback(async (act, options = {}) => {
    const docNo = String(readFirst(act, ['doc_no', 'DOC_NO'], '')).trim();
    if (!docNo) {
      return { ok: false, error: ACT_DOC_NO_ERROR };
    }

    const itemId = toNumberOrNull(readFirst(act, ['item_id', 'ITEM_ID'], null));
    const invNo = String(
      options.invNo
      || readFirst(act, ['inv_no', 'INV_NO'], '')
      || fallbackInvNo
      || ''
    ).trim();
    const docNumber = String(readFirst(act, ['doc_number', 'DOC_NUMBER'], docNo)).trim() || docNo;

    setOpeningDocNo(docNo);
    revokePreviewUrl();
    setPreview({
      open: true,
      loading: true,
      error: '',
      title: `Акт ${docNumber}`,
      subtitle: invNo ? `Инв. № ${invNo}` : '',
      kind: 'pdf',
      objectUrl: '',
      previewBlob: null,
    });

    try {
      const params = {};
      if (itemId !== null) params.item_id = itemId;
      if (invNo) params.inv_no = invNo;
      const selectedDb = normalizeDbId(localStorage.getItem('selected_database') || '');
      if (selectedDb) params.db_id = selectedDb;

      const response = await equipmentTransferActsAPI.downloadEquipmentActFile(docNo, params);
      const contentType = String(response?.headers?.['content-type'] || 'application/octet-stream');
      const fileName = fileNameFromContentDisposition(response?.headers?.['content-disposition'])
        || `act_${docNo}.pdf`;
      const blob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data], { type: contentType });

      if (!blob.size) {
        throw new Error('Файл акта пустой или недоступен на сервере.');
      }

      const sniff = await sniffBlobKind(blob);
      const resolved = resolveDocumentPreviewKind({
        contentType,
        fileName,
        sniff,
      });

      if (resolved.kind !== 'pdf') {
        const objectUrl = typeof window !== 'undefined' && window.URL?.createObjectURL
          ? window.URL.createObjectURL(blob)
          : '';
        objectUrlRef.current = objectUrl;
        setPreview({
          open: true,
          loading: false,
          error: resolved.error || 'Формат файла не поддерживается в предпросмотре.',
          title: fileName || `Акт ${docNumber}`,
          subtitle: invNo ? `Инв. № ${invNo}` : '',
          kind: 'unsupported',
          objectUrl,
          previewBlob: blob,
        });
        return { ok: false, error: resolved.error };
      }

      const objectUrl = typeof window !== 'undefined' && window.URL?.createObjectURL
        ? window.URL.createObjectURL(blob)
        : '';
      objectUrlRef.current = objectUrl;

      setPreview({
        open: true,
        loading: false,
        error: '',
        title: fileName || `Акт ${docNumber}`,
        subtitle: invNo ? `Инв. № ${invNo}` : '',
        kind: 'pdf',
        objectUrl,
        previewBlob: blob,
      });
      return { ok: true, error: '' };
    } catch (error) {
      console.error('Error opening equipment act file preview:', error);
      const apiDetail = error?.response?.data?.detail;
      let detail = typeof apiDetail === 'string' ? apiDetail : (error?.message || ACT_OPEN_ERROR);
      if (apiDetail instanceof Blob) {
        try {
          const text = await apiDetail.text();
          const parsed = JSON.parse(text);
          if (typeof parsed?.detail === 'string') detail = parsed.detail;
        } catch {
          // keep default
        }
      }
      setPreview((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: detail,
        objectUrl: '',
        previewBlob: null,
      }));
      return { ok: false, error: detail };
    } finally {
      setOpeningDocNo('');
    }
  }, [fallbackInvNo, revokePreviewUrl]);

  return {
    preview,
    openingDocNo,
    openActFile,
    closePreview,
  };
}

export default useEquipmentActFilePreview;
