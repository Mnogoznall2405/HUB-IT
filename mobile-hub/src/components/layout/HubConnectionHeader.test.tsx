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

  it('prioritizes the device offline state', () => {
    expect(resolveHubConnectionPresentation({
      offlineMode: true,
      hubStatus: 'connected',
      chatStatus: 'connected',
      chatEnabled: true,
    })).toEqual(expect.objectContaining({ kind: 'offline', label: 'Нет сети · офлайн-данные доступны' }));
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
