import { render } from '@testing-library/react-native';
import {
  HubConnectionInlineView,
  resolveHubConnectionPresentation,
} from './HubConnectionHeader';
import { getFluentTokens } from '../../theme/fluentTokens';

describe('HubConnectionHeader', () => {
  it('shows the normal HUB state only after required realtime channels are connected', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      hubStatus: 'connected',
      chatStatus: 'connected',
      chatEnabled: true,
    })).toEqual(expect.objectContaining({ kind: 'online', label: 'На связи' }));
  });

  it('does not downgrade the whole HUB while only the optional Chat realtime channel reconnects', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      hubStatus: 'connected',
      chatStatus: 'reconnecting',
      chatEnabled: true,
    })).toEqual(expect.objectContaining({ kind: 'online', label: 'На связи' }));
  });

  it('stops showing a spinner as soon as the authenticated REST session is ready', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      apiOnline: true,
      hubStatus: 'connecting',
    })).toEqual(expect.objectContaining({ kind: 'online', label: 'На связи' }));
  });

  it('describes a realtime-only failure without claiming that all HUB data is offline', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      apiOnline: true,
      hubStatus: 'reconnecting',
    })).toEqual(expect.objectContaining({
      kind: 'degraded',
      label: 'На связи · без мгновенных обновлений',
    }));
  });

  it('shows a stable degraded state instead of an endless spinner after realtime fails', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      hubStatus: 'reconnecting',
      chatStatus: 'connected',
      chatEnabled: true,
    })).toEqual(expect.objectContaining({ kind: 'degraded', label: 'Связь нестабильна' }));
  });

  it('reports connecting while a chat send is stalled despite live realtime', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      apiOnline: true,
      hubStatus: 'connected',
      sendStalled: true,
    })).toEqual(expect.objectContaining({ kind: 'connecting', label: 'Соединение…' }));
  });

  it('keeps the explicit offline and degraded states above a stalled send', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: true,
      connectivityOffline: true,
      apiOnline: true,
      hubStatus: 'connected',
      sendStalled: true,
    })).toEqual(expect.objectContaining({ kind: 'offline' }));
    expect(resolveHubConnectionPresentation({
      offlineMode: false,
      apiOnline: true,
      hubStatus: 'reconnecting',
      sendStalled: true,
    })).toEqual(expect.objectContaining({ kind: 'degraded' }));
  });

  it('prioritizes the device offline state', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: true,
      connectivityOffline: true,
      hubStatus: 'connected',
      chatStatus: 'connected',
      chatEnabled: true,
    })).toEqual(expect.objectContaining({ kind: 'offline', label: 'Нет сети · офлайн-данные доступны' }));
  });

  it('shows «Подключение…» while the cached session is checked against a reachable network', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: true,
      connectivityOffline: false,
      apiOnline: false,
      hubStatus: 'disconnected',
    })).toEqual(expect.objectContaining({ kind: 'connecting', label: 'Подключение…' }));
  });

  it('shows «Доступ из этой сети запрещён» when HUB-IT rejected the network itself', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: true,
      connectivityOffline: false,
      networkRestricted: true,
      apiOnline: false,
      hubStatus: 'disconnected',
    })).toEqual(expect.objectContaining({ kind: 'degraded', label: 'Доступ из этой сети запрещён' }));
  });

  it('renders the status inline without adding a second page header', async () => {
    const view = await render(
      <HubConnectionInlineView
        tokens={getFluentTokens('dark')}
        presentation={{ kind: 'online', label: 'На связи' }}
        showHub
      />,
    );

    expect(view.getByLabelText('HUB. На связи')).toBeTruthy();
    expect(view.getByText('HUB · На связи')).toBeTruthy();
    expect(view.queryByTestId('hub-connection-header')).toBeNull();
  });
});
