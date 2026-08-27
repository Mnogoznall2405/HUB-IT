import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageLoadEventData, type NativeSyntheticEvent } from 'react-native';
import {
  CHAT_PHOTO_DEFAULT_ASPECT,
  resolveChatPhotoAspect,
} from '../../chat/chatBubbleLayout';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

export function ChatBubblePhoto({
  uri,
  width,
  radius,
  children,
}: {
  uri: string;
  width: number;
  radius: number;
  children?: React.ReactNode;
}) {
  const { styles } = useChatStyles(createStyles);
  const [aspect, setAspect] = useState(CHAT_PHOTO_DEFAULT_ASPECT);

  useEffect(() => {
    setAspect(CHAT_PHOTO_DEFAULT_ASPECT);
  }, [uri]);

  const handleLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    const source = event.nativeEvent?.source;
    setAspect(resolveChatPhotoAspect(source?.width, source?.height));
  };

  return (
    <View style={[styles.frame, { width, height: Math.round(width / aspect), borderRadius: radius }]}>
      <ChatAuthenticatedImage
        uri={uri}
        style={styles.image}
        resizeMode="cover"
        onLoad={handleLoad}
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
