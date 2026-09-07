import { StyleSheet, View } from 'react-native';
import {
  resolveChatPhotoFrame,
} from '../../chat/chatBubbleLayout';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

export function ChatBubblePhoto({
  uri,
  maxWidth,
  maxHeight,
  radius,
  children,
}: {
  uri: string;
  maxWidth: number;
  maxHeight: number;
  radius: number;
  children?: React.ReactNode;
}) {
  const { styles } = useChatStyles(createStyles);
  // Reserve the same frame before loading and after confirmation of an upload.
  // Full-size viewing remains available by tapping the attachment.
  const frame = resolveChatPhotoFrame({ maxWidth, maxHeight });

  return (
    <View testID="chat-photo-frame" style={[styles.frame, { width: frame.width, height: frame.height, borderRadius: radius }]}>
      <ChatAuthenticatedImage
        uri={uri}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
      />
      {children}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  image: { width: '100%', height: '100%' },
});
