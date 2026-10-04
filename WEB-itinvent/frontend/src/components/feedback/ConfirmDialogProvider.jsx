import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';

/**
 * Стилизованная замена window.confirm / window.prompt (MUI Dialog, общая тема и dark mode).
 *
 *   const { confirm, prompt } = useConfirmDialog();
 *   const ok = await confirm({ title, message, confirmLabel, destructive });
 *   const value = await prompt({ title, label, initialValue, validate }); // null — отмена
 *
 * Esc / клик по фону — отмена. Enter в поле ввода или на самом диалоге — подтверждение;
 * Enter на кнопке, где стоит фокус, нажимает именно её. Для destructive-диалога фокус
 * изначально на «Отмена», кнопка подтверждения — цвета error.
 */
const ConfirmDialogContext = createContext(null);

const DIALOG_TITLE_ID = 'app-confirm-dialog-title';
const DIALOG_MESSAGE_ID = 'app-confirm-dialog-message';

function nativeFallback() {
  // Без провайдера (изолированный рендер компонента) — прежнее поведение браузера.
  return {
    confirm: async ({ title, message } = {}) => {
      if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
      return Boolean(window.confirm([title, message].filter(Boolean).join('\n')));
    },
    prompt: async ({ title, label, initialValue = '' } = {}) => {
      if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
      const value = window.prompt(label || title || '', initialValue);
      return value === null || value === undefined ? null : String(value);
    },
  };
}

export function ConfirmDialogProvider({ children }) {
  const [request, setRequest] = useState(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const requestRef = useRef(null);

  const settle = useCallback((result) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    current.resolve(result);
  }, []);

  const open = useCallback((kind, options = {}) => new Promise((resolve) => {
    // Новый запрос при открытом диалоге отменяет предыдущий.
    const previous = requestRef.current;
    if (previous) previous.resolve(previous.kind === 'prompt' ? null : false);
    const next = { kind, options, resolve };
    requestRef.current = next;
    setValue(kind === 'prompt' ? String(options.initialValue ?? '') : '');
    setTouched(false);
    setRequest(next);
  }), []);

  useEffect(() => () => {
    const current = requestRef.current;
    requestRef.current = null;
    if (current) current.resolve(current.kind === 'prompt' ? null : false);
  }, []);

  const confirm = useCallback((options) => open('confirm', options), [open]);
  const prompt = useCallback((options) => open('prompt', options), [open]);
  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  // Во время анимации закрытия показываем содержимое последнего запроса, а не дефолты.
  const shownRef = useRef(null);
  if (request) shownRef.current = request;
  const shown = request || shownRef.current;
  const kind = shown?.kind || 'confirm';
  const options = shown?.options || {};
  const destructive = Boolean(options.destructive);
  const isPrompt = kind === 'prompt';
  const validationError = isPrompt && typeof options.validate === 'function'
    ? (options.validate(value) || '')
    : '';
  const promptEmpty = isPrompt && options.allowEmpty !== true && !String(value).trim();
  const submitDisabled = Boolean(validationError) || promptEmpty;

  const handleCancel = useCallback(() => {
    settle(isPrompt ? null : false);
  }, [isPrompt, settle]);

  const handleConfirm = useCallback(() => {
    if (isPrompt) {
      setTouched(true);
      if (submitDisabled) return;
      settle(String(value));
      return;
    }
    settle(true);
  }, [isPrompt, settle, submitDisabled, value]);

  const handleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    const tag = String(event.target?.tagName || '').toUpperCase();
    // Enter на сфокусированной кнопке нажимает её саму (в т.ч. «Отмена»).
    if (tag === 'BUTTON') return;
    event.preventDefault();
    handleConfirm();
  }, [handleConfirm]);

  const confirmLabel = options.confirmLabel || (isPrompt ? 'Сохранить' : 'ОК');
  const cancelLabel = options.cancelLabel || 'Отмена';
  const title = options.title || (isPrompt ? '' : 'Подтвердите действие');
  const message = options.message || '';

  return (
    <ConfirmDialogContext.Provider value={api}>
      {children}
      <Dialog
        open={Boolean(request)}
        onClose={handleCancel}
        onKeyDown={handleKeyDown}
        fullWidth
        maxWidth="xs"
        aria-labelledby={title ? DIALOG_TITLE_ID : undefined}
        aria-describedby={message ? DIALOG_MESSAGE_ID : undefined}
        data-testid="app-confirm-dialog"
        PaperProps={{ sx: { borderRadius: '14px' } }}
      >
        {title ? (
          <DialogTitle id={DIALOG_TITLE_ID} sx={{ fontWeight: 700, pb: message || isPrompt ? 1 : 2 }}>
            {title}
          </DialogTitle>
        ) : null}
        {message || isPrompt ? (
          <DialogContent sx={{ pt: title ? 0 : 2 }}>
            {message ? (
              <DialogContentText id={DIALOG_MESSAGE_ID} sx={{ whiteSpace: 'pre-line', mb: isPrompt ? 1.5 : 0 }}>
                {message}
              </DialogContentText>
            ) : null}
            {isPrompt ? (
              <TextField
                autoFocus
                fullWidth
                size="small"
                margin="dense"
                label={options.label || undefined}
                placeholder={options.placeholder || undefined}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onFocus={(event) => event.target.select?.()}
                error={touched && Boolean(validationError)}
                helperText={touched && validationError ? validationError : undefined}
                inputProps={{ maxLength: options.maxLength || undefined }}
              />
            ) : null}
          </DialogContent>
        ) : null}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCancel} color="inherit" autoFocus={!isPrompt && destructive}>
            {cancelLabel}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={destructive ? 'error' : 'primary'}
            disabled={isPrompt && submitDisabled}
            autoFocus={!isPrompt && !destructive}
            disableElevation
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const value = useContext(ConfirmDialogContext);
  return useMemo(() => value || nativeFallback(), [value]);
}

export default ConfirmDialogProvider;
