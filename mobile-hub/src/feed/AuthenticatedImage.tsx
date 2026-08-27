import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { getChatMediaRequestHeaders } from '../files/chatMediaRequest';

export function AuthenticatedImage({
  uri,
  style,
  accessibilityLabel,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setHeaders(null);
    void getChatMediaRequestHeaders().then((next) => {
      if (!cancelled) setHeaders(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (failed || !headers) {
    return <View style={[styles.placeholder, style]} />;
  }

  return (
    <Image
      source={{ uri, headers }}
      style={style}
      resizeMode="cover"
      accessibilityLabel={accessibilityLabel}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: 'rgba(32, 31, 30, 0.06)',
  },
});
