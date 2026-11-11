import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { FadeInRow, SkeletonCards } from './LoadingSkeleton';

jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => false) }));
const { useReducedMotion } = jest.requireMock('../../accessibility/useReducedMotion') as { useReducedMotion: jest.Mock };

const tokens = { panelSolid: '#fff', borderSoft: '#ddd' } as never;

describe('LoadingSkeleton', () => {
  it('shows the requested number of placeholder cards, hidden from accessibility', async () => {
    const view = await render(<SkeletonCards tokens={tokens} count={3} testID="skeleton" />);
    const stack = view.getByTestId('skeleton', { includeHiddenElements: true });
    expect(stack.children).toHaveLength(3);
    expect(stack.props.accessibilityElementsHidden).toBe(true);
  });

  it('renders row content with and without motion', async () => {
    useReducedMotion.mockReturnValue(false);
    const animated = await render(<FadeInRow index={2}><Text>Строка</Text></FadeInRow>);
    expect(animated.getByText('Строка')).toBeTruthy();
    useReducedMotion.mockReturnValue(true);
    const still = await render(<FadeInRow index={0}><Text>Без анимации</Text></FadeInRow>);
    expect(still.getByText('Без анимации')).toBeTruthy();
  });
});
