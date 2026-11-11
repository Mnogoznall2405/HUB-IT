import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useNativeBottomNavInset } from './useNativeBottomNavInset';
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 360, height: 800, scale: 1, fontScale: mockFontScale }),
}));
beforeEach(() => { mockFontScale = 1; });

function Probe({ hidden = false }: { hidden?: boolean }) {
  return <Text>{useNativeBottomNavInset(hidden)}</Text>;
}

it('updates content clearance when the current system inset changes', async () => {
  const wrap = (bottom: number, hidden = false) => (
    <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom }}>
      <Probe hidden={hidden} />
    </SafeAreaInsetsContext.Provider>
  );
  const view = await render(wrap(0));
  expect(view.getByText('81')).toBeTruthy();
  await view.rerender(wrap(34));
  expect(view.getByText('106')).toBeTruthy();
  mockFontScale = 2;
  await view.rerender(wrap(34));
  expect(view.getByText('144')).toBeTruthy();
  await view.rerender(wrap(34, true));
  expect(view.getByText('0')).toBeTruthy();
});
