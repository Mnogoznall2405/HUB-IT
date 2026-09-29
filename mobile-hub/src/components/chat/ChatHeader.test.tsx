import { act, render } from '@testing-library/react-native';
import { ChatHeader } from './ChatHeader';

let mockPresentation: { kind: 'online' | 'connecting' | 'degraded' | 'offline'; label: string } = {
  kind: 'online',
  label: 'На связи',
};

jest.mock('../layout/HubConnectionHeader', () => ({
  useHubConnectionPresentation: () => mockPresentation,
}));

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

function renderHeader(props: Partial<Parameters<typeof ChatHeader>[0]> = {}) {
  return render(
    <ChatHeader
      title="Иван Петров"
      subtitle="в сети"
      onBack={jest.fn()}
      socketStatus="connected"
      {...props}
    />,
  );
}

describe('ChatHeader', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPresentation = { kind: 'online', label: 'На связи' };
  });
  afterEach(() => jest.useRealTimers());

  it('shows the title and presence subtitle while connected', async () => {
    const view = await renderHeader();

    expect(view.getByText('Иван Петров')).toBeTruthy();
    expect(view.getByText('в сети')).toBeTruthy();
    expect(view.queryByText('На связи')).toBeNull();
    expect(view.queryByText('Соединение…')).toBeNull();
  });

  it('never shows the app connection state in place of the peer presence', async () => {
    const view = await renderHeader({ subtitle: undefined });

    expect(view.queryByText('На связи')).toBeNull();
    expect(view.queryByTestId('hub-connection-inline')).toBeNull();
  });

  it('swaps the title for the connection status after a debounce and keeps presence', async () => {
    mockPresentation = { kind: 'connecting', label: 'Соединение…' };
    const view = await renderHeader();

    expect(view.getByText('Иван Петров')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1100); });

    expect(view.getByText('Соединение…')).toBeTruthy();
    expect(view.queryByText('Иван Петров')).toBeNull();
    expect(view.getByText('в сети')).toBeTruthy();
  });

  it('restores the title immediately once the connection recovers', async () => {
    mockPresentation = { kind: 'connecting', label: 'Соединение…' };
    const view = await renderHeader();
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(view.getByText('Соединение…')).toBeTruthy();

    mockPresentation = { kind: 'online', label: 'На связи' };
    await view.rerender(
      <ChatHeader title="Иван Петров" subtitle="в сети" onBack={jest.fn()} socketStatus="connected" />,
    );

    expect(view.getByText('Иван Петров')).toBeTruthy();
    expect(view.queryByText('Соединение…')).toBeNull();
  });

  it('shows waiting-for-network while the device is offline', async () => {
    mockPresentation = { kind: 'offline', label: 'Нет сети · офлайн-данные доступны' };
    const view = await renderHeader({ socketStatus: 'offline' });
    await act(async () => { jest.advanceTimersByTime(1100); });

    expect(view.getByText('Ожидание сети…')).toBeTruthy();
    expect(view.getByText('в сети')).toBeTruthy();
  });

  it('shows updating when only realtime is degraded but the API still works', async () => {
    mockPresentation = { kind: 'degraded', label: 'На связи · без мгновенных обновлений' };
    const view = await renderHeader({ socketStatus: 'connected' });
    await act(async () => { jest.advanceTimersByTime(1100); });

    expect(view.getByText('Обновление…')).toBeTruthy();
  });

  it('treats a reconnecting chat socket as a connection status even when HUB is online', async () => {
    const view = await renderHeader({ socketStatus: 'reconnecting' });
    await act(async () => { jest.advanceTimersByTime(1100); });

    expect(view.getByText('Соединение…')).toBeTruthy();
    expect(view.getByText('в сети')).toBeTruthy();
  });
});
