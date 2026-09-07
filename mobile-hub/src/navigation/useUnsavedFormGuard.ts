import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/** Covers header actions, navigator removal and Android's normal back action. */
export function useUnsavedFormGuard(dirty: boolean, busy = false) {
  const navigation = useNavigation();
  const [exit, setExit] = useState<{ run: () => void } | null>(null);
  const promptOpen = useRef(false);
  const current = useRef({ dirty, busy });
  current.current = { dirty, busy };

  const leaveSaved = useCallback((run: () => void) => setExit({ run }), []);
  const requestLeave = useCallback((run: () => void) => {
    if (current.current.busy) {
      Alert.alert('Сохранение', 'Дождитесь завершения операции.');
      return;
    }
    if (!current.current.dirty) {
      run();
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    const cancel = () => { promptOpen.current = false; };
    Alert.alert('Выйти без сохранения?', 'Несохранённые изменения будут потеряны.', [
      { text: 'Остаться', style: 'cancel', onPress: cancel },
      { text: 'Выйти', style: 'destructive', onPress: () => {
        cancel();
        if (!current.current.busy) setExit({ run });
      } },
    ], { cancelable: true, onDismiss: cancel });
  }, []);

  usePreventRemove(!exit && (dirty || busy), ({ data }) => {
    requestLeave(() => navigation.dispatch(data.action));
  });

  // Run only after usePreventRemove has committed its disabled state.
  useEffect(() => {
    if (exit) exit.run();
  }, [exit]);

  return { requestLeave, leaveSaved };
}
