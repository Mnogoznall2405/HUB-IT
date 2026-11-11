import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { NativeCommandName } from './nativeCommandContract';
import { useMobileUpdater } from '../updates/useMobileUpdater';
import {
  executeNativeCommand,
  type NativeCommandExecutionOptions,
} from './nativeCommandRuntime';

export function useNativeCommands() {
  const {
    user,
    biometricEnabled,
    enableBiometrics,
    skipBiometrics,
  } = useAuth();
  const updater = useMobileUpdater();
  const dependencies = {
    user,
    biometricEnabled,
    enableBiometrics,
    skipBiometrics,
    updater,
  };
  const dependenciesRef = useRef(dependencies);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  }, [biometricEnabled, enableBiometrics, skipBiometrics, updater, user]);

  const execute = useCallback((
    command: NativeCommandName,
    payload: Record<string, unknown> = {},
    executionOptions: NativeCommandExecutionOptions = {},
  ) => executeNativeCommand(command, payload, dependenciesRef.current, executionOptions), []);

  return { execute, updater };
}
