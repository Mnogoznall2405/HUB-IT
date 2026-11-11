import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import type { ChatSocketStatus } from '../../chat/chatSocket';
import { countStalledChatSends } from '../../diagnostics/chatSendTiming';
import { hubRealtimeSocket, type HubRealtimeStatus } from '../../realtime/hubRealtimeSocket';
import { useAppFluentTokens, type FluentTokens } from '../../theme/fluentTokens';

export type HubConnectionPresentation = {
  kind: 'online' | 'connecting' | 'degraded' | 'offline';
  label: string;
};

const DEFAULT_PRESENTATION: HubConnectionPresentation = {
  kind: 'online',
  label: 'На связи',
};

const HubConnectionContext = createContext<HubConnectionPresentation>(DEFAULT_PRESENTATION);

export function resolveHubConnectionPresentation(input: {
  offlineMode: boolean;
  connectivityOffline?: boolean;
  networkRestricted?: boolean;
  apiOnline?: boolean;
  hubStatus: HubRealtimeStatus;
  chatStatus?: ChatSocketStatus;
  chatEnabled?: boolean;
  sendStalled?: boolean;
}): HubConnectionPresentation {
  const { offlineMode, apiOnline = false, hubStatus } = input;
  if (offlineMode) {
    // The session works from cached data in three distinct states: HUB-IT
    // answered that this network is not allowed for the account ("Доступ из
    // этой сети запрещён"), Android reports a dead network ("Нет сети"), or the
    // background /auth/me check is still reaching for the server
    // ("Подключение…").
    if (input.networkRestricted) return { kind: 'degraded', label: 'Доступ из этой сети запрещён' };
    return input.connectivityOffline
      ? { kind: 'offline', label: 'Нет сети · офлайн-данные доступны' }
      : { kind: 'connecting', label: 'Подключение…' };
  }
  if (hubStatus === 'connected') {
    return input.sendStalled ? { kind: 'connecting', label: 'Соединение…' } : DEFAULT_PRESENTATION;
  }
  if (hubStatus === 'error' || hubStatus === 'offline' || hubStatus === 'reconnecting' || hubStatus === 'suspended') {
    return apiOnline
      ? { kind: 'degraded', label: 'На связи · без мгновенных обновлений' }
      : { kind: 'degraded', label: 'Связь нестабильна' };
  }
  if (input.sendStalled) return { kind: 'connecting', label: 'Соединение…' };
  if (apiOnline) return DEFAULT_PRESENTATION;
  return { kind: 'connecting', label: 'Подключение…' };
}

export function HubConnectionProvider({ children }: { children: ReactNode }) {
  const { connectivityOffline, offlineMode, sessionNetworkRestricted, user } = useAuth();
  const [hubStatus, setHubStatus] = useState<HubRealtimeStatus>(hubRealtimeSocket.getStatus());
  const [sendStalled, setSendStalled] = useState(false);

  useEffect(() => hubRealtimeSocket.on('status', (next) => {
    setHubStatus(String(next || 'disconnected') as HubRealtimeStatus);
  }), []);

  // A socket can stay silent-healthy while HTTP is dead: poll the send-path
  // marks so a stuck send still surfaces as a connection problem.
  useEffect(() => {
    const update = () => setSendStalled(countStalledChatSends() > 0);
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, []);

  const presentation = useMemo(() => resolveHubConnectionPresentation({
    offlineMode,
    connectivityOffline,
    networkRestricted: sessionNetworkRestricted,
    apiOnline: Boolean(user && !offlineMode),
    hubStatus,
    sendStalled,
  }), [connectivityOffline, hubStatus, offlineMode, sessionNetworkRestricted, user, sendStalled]);

  return (
    <HubConnectionContext.Provider value={presentation}>
      {children}
    </HubConnectionContext.Provider>
  );
}

export function useHubConnectionPresentation(): HubConnectionPresentation {
  return useContext(HubConnectionContext);
}

export function HubConnectionInline({
  showHub = false,
  onlineLabel,
  style,
}: {
  showHub?: boolean;
  onlineLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tokens = useAppFluentTokens();
  const presentation = useHubConnectionPresentation();
  return (
    <HubConnectionInlineView
      tokens={tokens}
      presentation={presentation}
      showHub={showHub}
      onlineLabel={onlineLabel}
      style={style}
    />
  );
}

export function HubConnectionInlineView({
  tokens,
  presentation,
  showHub = false,
  onlineLabel,
  style,
}: {
  tokens: FluentTokens;
  presentation: HubConnectionPresentation;
  showHub?: boolean;
  onlineLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const statusColor = connectionColor(tokens, presentation.kind);
  const visibleLabel = presentation.kind === 'online' && String(onlineLabel || '').trim()
    ? String(onlineLabel).trim()
    : presentation.label;
  const copy = showHub ? `HUB · ${visibleLabel}` : visibleLabel;

  return (
    <View
      testID="hub-connection-inline"
      style={[styles.inline, style]}
      accessible
      accessibilityLabel={`${showHub ? 'HUB. ' : ''}${visibleLabel}`}
      accessibilityLiveRegion="polite"
    >
      {presentation.kind === 'connecting' ? (
        <ActivityIndicator testID="hub-connection-spinner" size={11} color={statusColor} />
      ) : (
        <MaterialCommunityIcons
          name={presentation.kind === 'online'
            ? 'circle'
            : presentation.kind === 'offline' ? 'cloud-off-outline' : 'alert-circle-outline'}
          size={presentation.kind === 'online' ? 7 : 13}
          color={statusColor}
        />
      )}
      <Text numberOfLines={1} style={[styles.inlineText, { color: statusColor }]}>{copy}</Text>
    </View>
  );
}

function connectionColor(tokens: FluentTokens, kind: HubConnectionPresentation['kind']): string {
  if (kind === 'online') return tokens.success;
  if (kind === 'offline' || kind === 'degraded') return tokens.warning;
  return tokens.primaryLight;
}

const styles = StyleSheet.create({
  inline: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inlineText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
  },
});
