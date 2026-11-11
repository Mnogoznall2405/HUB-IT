import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/** Covers header actions, navigator removal and Android's normal back action. */
export function useUnsavedFormGuard(dirty: boolean, busy = false, options?: {
  title?: string;
  message?: string;
  confirmLabel?: string;
  beforeLeave?: () => Promise<void>;
  onLeaveError?: (error: unknown) => void;
}) {
  const navigation = useNavigation();
  const [exit, setExit] = useState<{ run: () => void } | null>(null);
  const promptOpen = useRef(false);
  const preparing = useRef(false);
  const [preparingExit, setPreparingExit] = useState(false);
  const current = useRef({ dirty, busy, options });
  current.current = { dirty, busy, options };

  const leaveSaved = useCallback((run: () => void) => setExit({ run }), []);
  const requestLeave = useCallback((run: () => void) => {
    if (current.current.busy || preparing.current) {
      Alert.alert('Сохранение', 'Дождитесь завершения операции.');
      return;
    }
    const performExit = async () => {
      if (current.current.busy || preparing.current) return;
      const configuration = current.current.options;
      if (!configuration?.beforeLeave) { setExit({ run }); return; }
      preparing.current = true; setPreparingExit(true);
      try {
        await configuration.beforeLeave();
        setExit({ run });
      } catch (error) {
        if (configuration.onLeaveError) configuration.onLeaveError(error);
        else Alert.alert('Не удалось сохранить', 'Форма остаётся открытой. Повторите сохранение.');
      } finally { preparing.current = false; setPreparingExit(false); }
    };
    if (!current.current.dirty) {
      if (current.current.options?.beforeLeave) void performExit();
      else run();
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    const cancel = () => { promptOpen.current = false; };
    Alert.alert(current.current.options?.title || 'Выйти без сохранения?', current.current.options?.message || 'Несохранённые изменения будут потеряны.', [
      { text: 'Остаться', style: 'cancel', onPress: cancel },
      { text: current.current.options?.confirmLabel || 'Выйти', style: current.current.options?.beforeLeave ? 'default' : 'destructive', onPress: () => {
        cancel();
        void performExit();
      } },
    ], { cancelable: true, onDismiss: cancel });
  }, []);

  usePreventRemove(!exit && (dirty || busy || preparingExit), ({ data }) => {
    requestLeave(() => navigation.dispatch(data.action));
  });

  // Run only after usePreventRemove has committed its disabled state.
  useEffect(() => {
    if (exit) exit.run();
  }, [exit]);

  return { requestLeave, leaveSaved };
}
