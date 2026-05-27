import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import { chatTokens } from '../../theme/chatTokens';

export function ChatHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <IconButton icon="arrow-left" onPress={() => router.back()} />
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: chatTokens.threadTopbarBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
    paddingRight: 8,
  },
  textBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '600', color: chatTokens.textPrimary },
  subtitle: { fontSize: 13, color: chatTokens.textSecondary, marginTop: 2 },
});
