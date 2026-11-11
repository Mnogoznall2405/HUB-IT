import axios from 'axios';
import { formatApiError } from '../api/formatError';

export type NativeDocflowError = {
  code: string;
  message: string;
  correlationId: string;
};

export function resolveNativeDocflowError(error: unknown, fallback: string): NativeDocflowError {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const row = detail as Record<string, unknown>;
      return {
        code: String(row.code || '').trim(),
        message: String(row.message || '').trim() || fallback,
        correlationId: String(row.correlation_id || '').trim(),
      };
    }
  }
  return { code: '', message: formatApiError(error, fallback), correlationId: '' };
}

