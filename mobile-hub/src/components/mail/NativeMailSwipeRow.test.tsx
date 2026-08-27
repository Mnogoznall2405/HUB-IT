import { render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailSwipeRow } from './NativeMailSwipeRow';

it('closes the swipe surface when the read state changes after an action', async () => {
  const tokens = getFluentTokens('dark');
  const onAction = jest.fn();
  const resetSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  const view = await render(
    <NativeMailSwipeRow isRead={false} canDelete disabled={false} tokens={tokens} onAction={onAction}>
      <Text>Письмо</Text>
    </NativeMailSwipeRow>,
  );
  resetSpy.mockClear();

  await view.rerender(
    <NativeMailSwipeRow isRead canDelete disabled tokens={tokens} onAction={onAction}>
      <Text>Письмо</Text>
    </NativeMailSwipeRow>,
  );

  expect(resetSpy).toHaveBeenCalledWith(0);
});
