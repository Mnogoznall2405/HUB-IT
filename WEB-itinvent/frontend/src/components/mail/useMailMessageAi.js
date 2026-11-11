import { useCallback, useEffect, useRef, useState } from 'react';
import { mailAiAPI } from '../../api/mailAi';

const resolveAiErrorMessage = (error, fallback = 'Не удалось выполнить AI-действие для письма.') => {
  const responseDetail = error?.response?.data?.detail;
  if (typeof responseDetail === 'string' && responseDetail.trim()) {
    return responseDetail.trim();
  }
  if (Array.isArray(responseDetail)) {
    const joined = responseDetail
      .map((item) => String(item?.msg || item?.message || item || '').trim())
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }
  const message = String(error?.message || '').trim();
  if (message && !message.toLowerCase().includes('network error')) {
    return message;
  }
  return fallback;
};

export default function useMailMessageAi({
  messageId = '',
  mailboxId = '',
  enabled = true,
  onError,
} = {}) {
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [smartReplies, setSmartReplies] = useState([]);
  const [smartRepliesLoading, setSmartRepliesLoading] = useState(false);
  const [smartRepliesLoaded, setSmartRepliesLoaded] = useState(false);
  const cacheRef = useRef(new Map());
  const summaryAbortRef = useRef(null);
  const smartRepliesAbortRef = useRef(null);

  const cacheKey = `${mailboxId || 'default'}:${messageId || ''}`;

  useEffect(() => {
    setSummary('');
    setSmartReplies([]);
    setSmartRepliesLoaded(false);
    setSummaryLoading(false);
    setSmartRepliesLoading(false);
    summaryAbortRef.current?.abort?.();
    smartRepliesAbortRef.current?.abort?.();
    summaryAbortRef.current = null;
    smartRepliesAbortRef.current = null;
  }, [cacheKey]);

  const loadSummary = useCallback(async () => {
    if (!enabled || !messageId) {
      return { summary: '', error: 'Пересказ недоступен для этого письма.' };
    }

    const cached = cacheRef.current.get(`${cacheKey}:summary`);
    if (cached) {
      setSummary(cached);
      return { summary: cached, error: '' };
    }

    summaryAbortRef.current?.abort?.();
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryLoading(true);
    try {
      const data = await mailAiAPI.summarizeMessage(messageId, mailboxId, { signal: controller.signal });
      if (controller.signal.aborted || summaryAbortRef.current !== controller) {
        return { summary: '', error: '' };
      }
      const nextSummary = String(data?.summary || '').trim();
      if (!nextSummary) {
        const errorMessage = 'AI вернул пустой пересказ.';
        onError?.(new Error(errorMessage));
        return { summary: '', error: errorMessage };
      }
      cacheRef.current.set(`${cacheKey}:summary`, nextSummary);
      setSummary(nextSummary);
      return { summary: nextSummary, error: '' };
    } catch (error) {
      if (controller.signal.aborted || summaryAbortRef.current !== controller) {
        return { summary: '', error: '' };
      }
      const errorMessage = resolveAiErrorMessage(error);
      return { summary: '', error: errorMessage };
    } finally {
      if (!controller.signal.aborted && summaryAbortRef.current === controller) {
        setSummaryLoading(false);
      }
    }
  }, [cacheKey, enabled, mailboxId, messageId, onError]);

  const loadSmartReplies = useCallback(async () => {
    if (!enabled || !messageId || smartRepliesLoaded) return [];
    const cached = cacheRef.current.get(`${cacheKey}:smart-replies`);
    if (cached) {
      setSmartReplies(cached);
      setSmartRepliesLoaded(true);
      return cached;
    }

    smartRepliesAbortRef.current?.abort?.();
    const controller = new AbortController();
    smartRepliesAbortRef.current = controller;
    setSmartRepliesLoading(true);
    try {
      const data = await mailAiAPI.getSmartReplies(messageId, mailboxId, { signal: controller.signal });
      if (controller.signal.aborted || smartRepliesAbortRef.current !== controller) {
        return [];
      }
      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      cacheRef.current.set(`${cacheKey}:smart-replies`, suggestions);
      setSmartReplies(suggestions);
      setSmartRepliesLoaded(true);
      return suggestions;
    } catch (error) {
      if (controller.signal.aborted || smartRepliesAbortRef.current !== controller) {
        return [];
      }
      onError?.(error);
      setSmartRepliesLoaded(true);
      return [];
    } finally {
      if (!controller.signal.aborted && smartRepliesAbortRef.current === controller) {
        setSmartRepliesLoading(false);
      }
    }
  }, [cacheKey, enabled, mailboxId, messageId, onError, smartRepliesLoaded]);

  useEffect(() => () => {
    summaryAbortRef.current?.abort?.();
    smartRepliesAbortRef.current?.abort?.();
  }, []);

  return {
    summary,
    summaryLoading,
    smartReplies,
    smartRepliesLoading,
    loadSummary,
    loadSmartReplies,
  };
}
