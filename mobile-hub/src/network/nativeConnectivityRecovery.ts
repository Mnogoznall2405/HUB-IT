export type NativeConnectivityRecoveryController = {
  reportConnectivity(online: boolean): void;
  requestRecovery(path?: string): void;
  dispose(): void;
};

type RecoveryTimer = ReturnType<typeof setTimeout>;

type NativeConnectivityRecoveryOptions = {
  recover(path?: string): Promise<boolean>;
  onOffline(): void;
  onRecovered?(): void;
  retryDelaysMs?: readonly number[];
};

export function createNativeConnectivityRecoveryController({
  recover,
  onOffline,
  onRecovered = () => undefined,
  retryDelaysMs = [2_000, 5_000, 15_000, 30_000],
}: NativeConnectivityRecoveryOptions): NativeConnectivityRecoveryController {
  const delays = retryDelaysMs.length ? [...retryDelaysMs] : [30_000];
  let disposed = false;
  let online: boolean | null = null;
  let offlineObserved = false;
  let recoveryInFlight = false;
  let retryAttempt = 0;
  let requestedPath: string | undefined;
  let retryTimer: RecoveryTimer | null = null;

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRecovery = (delayMs: number) => {
    clearRetry();
    retryTimer = setTimeout(runRecovery, Math.max(0, delayMs));
  };

  const runRecovery = () => {
    retryTimer = null;
    if (disposed || !offlineObserved || online !== true) return;
    if (recoveryInFlight) {
      scheduleRecovery(1_000);
      return;
    }
    recoveryInFlight = true;
    void recover(requestedPath)
      .then((restored) => {
        if (!restored || online !== true || disposed) return;
        offlineObserved = false;
        retryAttempt = 0;
        clearRetry();
        onRecovered();
      })
      .catch(() => false)
      .finally(() => {
        recoveryInFlight = false;
        if (disposed || !offlineObserved || online !== true || retryTimer) return;
        const delay = delays[Math.min(retryAttempt, delays.length - 1)];
        retryAttempt += 1;
        scheduleRecovery(delay);
      });
  };

  return {
    reportConnectivity(nextOnline) {
      if (disposed) return;
      const previousOnline = online;
      online = nextOnline;
      if (!nextOnline) {
        offlineObserved = true;
        retryAttempt = 0;
        clearRetry();
        if (previousOnline !== false) onOffline();
        return;
      }
      if (previousOnline !== true) runRecovery();
    },
    requestRecovery(path) {
      if (disposed) return;
      if (path) requestedPath = path;
      offlineObserved = true;
      online = true;
      runRecovery();
    },
    dispose() {
      disposed = true;
      clearRetry();
    },
  };
}
