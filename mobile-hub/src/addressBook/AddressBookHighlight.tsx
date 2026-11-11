import { Text, type StyleProp, type TextStyle } from 'react-native';
import { splitHighlightParts } from './addressBookFormat';

export function AddressBookHighlight({
  value,
  query,
  style,
  numberOfLines,
  testID,
}: {
  value?: unknown;
  query?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  testID?: string;
}) {
  const parts = splitHighlightParts(value, query);
  if (parts.length === 0) return null;
  return (
    <Text style={style} numberOfLines={numberOfLines} testID={testID}>
      {parts.map((part, index) => (
        part.match ? (
          <Text key={`${part.text}-${index}`} style={{ backgroundColor: '#fde7c3', color: '#201f1e' }}>
            {part.text}
          </Text>
        ) : part.text
      ))}
    </Text>
  );
}
