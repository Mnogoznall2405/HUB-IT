import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { NativeScanPhotoPanel } from './NativeScanPhotoPanel';

const tokens = {
  primary: '#0a6',
  error: '#d00',
  textPrimary: '#111',
  textSecondary: '#666',
  textTertiary: '#999',
  panelSolid: '#fff',
  borderStrong: '#bbb',
} as never;

const baseProps = {
  tokens,
  title: 'Монитор Dell',
  invNo: '12345',
  uploaded: 2,
  pending: 0,
  failed: 0,
  capturing: false,
  onCapture: jest.fn(),
  onRetry: jest.fn(),
  onDiscardFailed: jest.fn(),
  onExit: jest.fn(),
};

describe('NativeScanPhotoPanel', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => { await cleanup(); });

  it('tells the shooter when the server is unreachable and offers the battery fix only then', async () => {
    const onCheckLink = jest.fn();
    const onBatterySettings = jest.fn();
    const link = { offline: false, check: { at: Date.now(), ok: true }, checking: false, batteryRestricted: true };
    const view = await render(
      <NativeScanPhotoPanel {...baseProps} link={link} onCheckLink={onCheckLink} onBatterySettings={onBatterySettings} />,
    );

    // Сервер отвечает: подсказка про батарею шумела бы зря.
    expect((await view.findByTestId('native-scan-photo-link-text')).props.children).toContain('Сервер на связи');
    expect(view.queryByTestId('native-scan-photo-battery')).toBeNull();

    await view.rerender(
      <NativeScanPhotoPanel
        {...baseProps}
        link={{ ...link, offline: true }}
        onCheckLink={onCheckLink}
        onBatterySettings={onBatterySettings}
      />,
    );
    expect((await view.findByTestId('native-scan-photo-link-text')).props.children).toContain('Нет связи с сервером');
    await fireEvent.press(await view.findByTestId('native-scan-photo-battery'));
    expect(onBatterySettings).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('native-scan-photo-check-link'));
    expect(onCheckLink).toHaveBeenCalledTimes(1);

    // Батарея не мешает (или состояние неизвестно): подсказки нет даже без связи.
    await view.rerender(
      <NativeScanPhotoPanel {...baseProps} link={{ ...link, offline: true, batteryRestricted: false }} onBatterySettings={onBatterySettings} />,
    );
    expect(view.queryByTestId('native-scan-photo-battery')).toBeNull();
  });

  it('lets the shooter turn, retake or send a pending frame', async () => {
    const onPreviewRotate = jest.fn();
    const onPreviewAccept = jest.fn();
    const onPreviewRetake = jest.fn();
    const view = await render(
      <NativeScanPhotoPanel
        {...baseProps}
        preview={{ uri: 'file:///shot.jpg', busy: false }}
        onPreviewRotate={onPreviewRotate}
        onPreviewAccept={onPreviewAccept}
        onPreviewRetake={onPreviewRetake}
      />,
    );

    // Пока кадр на проверке, затвора нет — следующий снимок не затрёт этот.
    expect(view.queryByTestId('native-scan-photo-shutter')).toBeNull();
    await fireEvent.press(view.getByTestId('native-scan-photo-rotate-right'));
    await fireEvent.press(view.getByTestId('native-scan-photo-rotate-left'));
    expect(onPreviewRotate.mock.calls).toEqual([[90], [-90]]);
    await fireEvent.press(view.getByTestId('native-scan-photo-retake'));
    expect(onPreviewRetake).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('native-scan-photo-accept'));
    expect(onPreviewAccept).toHaveBeenCalledTimes(1);
  });

  it('switches the frame check off and on from the panel', async () => {
    const onTogglePreview = jest.fn();
    const view = await render(
      <NativeScanPhotoPanel {...baseProps} previewEnabled onTogglePreview={onTogglePreview} />,
    );

    const toggle = await view.findByTestId('native-scan-photo-preview-toggle');
    expect(toggle.props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(toggle);
    expect(onTogglePreview).toHaveBeenCalledTimes(1);
  });
});
