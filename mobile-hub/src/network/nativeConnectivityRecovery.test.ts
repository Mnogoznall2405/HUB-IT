import { createNativeConnectivityRecoveryController } from './nativeConnectivityRecovery';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('native connectivity recovery controller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does nothing for the initial online state and recovers once after offline', async () => {
    const recover = jest.fn(async () => true);
    const onOffline = jest.fn();
    const onRecovered = jest.fn();
    const controller = createNativeConnectivityRecoveryController({
      recover,
      onOffline,
      onRecovered,
    });

    controller.reportConnectivity(true);
    expect(recover).not.toHaveBeenCalled();
    controller.reportConnectivity(false);
    controller.reportConnectivity(false);
    expect(onOffline).toHaveBeenCalledTimes(1);
    controller.reportConnectivity(true);
    await flushPromises();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('retries a reachable network until the backend bootstrap succeeds', async () => {
    const recover = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onRecovered = jest.fn();
    const controller = createNativeConnectivityRecoveryController({
      recover,
      onOffline: jest.fn(),
      onRecovered,
      retryDelaysMs: [2_000, 5_000],
    });

    controller.reportConnectivity(false);
    controller.requestRecovery('/mail?folder=inbox');
    await flushPromises();
    expect(recover).toHaveBeenCalledWith('/mail?folder=inbox');
    expect(onRecovered).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_999);
    expect(recover).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('cancels a pending retry when Android reports offline again', async () => {
    const recover = jest.fn(async () => false);
    const controller = createNativeConnectivityRecoveryController({
      recover,
      onOffline: jest.fn(),
      retryDelaysMs: [2_000],
    });

    controller.reportConnectivity(false);
    controller.reportConnectivity(true);
    await flushPromises();
    controller.reportConnectivity(false);
    jest.advanceTimersByTime(10_000);
    await flushPromises();

    expect(recover).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
