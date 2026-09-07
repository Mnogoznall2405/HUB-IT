import { createNativeChatLeaveController } from './nativeChatLeaveThread';

describe('nativeChatLeaveThread', () => {
  it('navigates immediately while mark-read stays pending', async () => {
    let resolveMark: (() => void) | undefined;
    const markRead = jest.fn(() => new Promise<void>((resolve) => { resolveMark = resolve; }));
    const navigateAway = jest.fn();
    const controller = createNativeChatLeaveController({ navigateAway, markRead });

    const result = controller.leave({ id: 'm1' } as never);
    expect(result.navigated).toBe(true);
    expect(navigateAway).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith('m1');
    expect(controller.navigationCount).toBe(1);

    controller.leave({ id: 'm1' } as never);
    expect(navigateAway).toHaveBeenCalledTimes(1);

    resolveMark?.();
    await Promise.resolve();
    expect(navigateAway).toHaveBeenCalledTimes(1);
  });

  it('does not start mark-read offline', () => {
    const markRead = jest.fn(async () => undefined);
    const navigateAway = jest.fn();
    const controller = createNativeChatLeaveController({ navigateAway, markRead, offline: true });
    controller.leave({ id: 'm1' } as never);
    expect(navigateAway).toHaveBeenCalledTimes(1);
    expect(markRead).not.toHaveBeenCalled();
  });
});
