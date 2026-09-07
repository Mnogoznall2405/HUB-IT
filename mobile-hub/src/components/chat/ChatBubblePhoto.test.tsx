import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ChatBubblePhoto } from './ChatBubblePhoto';

jest.mock('./ChatAuthenticatedImage', () => ({ ChatAuthenticatedImage: () => null }));

it('keeps the reserved photo frame when a local preview becomes a server attachment', async () => {
  const view = await render(<ChatBubblePhoto uri="file://preview.jpg" maxWidth={300} maxHeight={240} radius={14} />);
  const before = StyleSheet.flatten(view.getByTestId('chat-photo-frame').props.style);
  await view.rerender(<ChatBubblePhoto uri="https://example.invalid/image" maxWidth={300} maxHeight={240} radius={14} />);
  const after = StyleSheet.flatten(view.getByTestId('chat-photo-frame').props.style);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
});
