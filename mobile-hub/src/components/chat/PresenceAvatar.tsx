import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { API_V1_BASE } from '../../api/config';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

function resolveAvatarUrl(url?: string | null): string | undefined {
  const raw = String(url || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('http')) return raw;
  const origin = API_V1_BASE.replace(/\/api\/v1\/?$/, '');
  return `${origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function PresenceAvatar({
  label,
  avatarUrl,
  size = 48,
  online = false,
}: {
  label: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
}) {
  const chatTokens = useChatTokens();
  const styles = React.useMemo(() => createStyles(chatTokens), [chatTokens]);
  const uri = resolveAvatarUrl(avatarUrl);
  const fallback = (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initialsFromLabel(label)}</Text>
    </View>
  );
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <ChatAuthenticatedImage
          uri={uri}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          accessible={false}
          loadingFallback={fallback}
          errorFallback={fallback}
        />
      ) : (
        fallback
      )}
      {online ? <View style={[styles.dot, { right: 0, bottom: 0 }]} /> : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  fallback: {
    backgroundColor: chatTokens.sidebarRowSoftActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: chatTokens.accentText, fontWeight: '600' },
  dot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#3a8f35',
    borderWidth: 2,
    borderColor: chatTokens.panelBg,
  },
});
