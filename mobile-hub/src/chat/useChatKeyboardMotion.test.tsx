import { render } from '@testing-library/react-native';
import { Keyboard, Platform, Text, type KeyboardEvent } from 'react-native';
import { useChatKeyboardMotion } from './useChatKeyboardMotion';

const mockReducedMotion = jest.fn(() => false);
jest.mock('../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion() }));
function Probe() { useChatKeyboardMotion(); return <Text>keyboard</Text>; }

it('uses the iOS keyboard timing and removes its subscription', async () => {
  const platform = Platform.OS;
  Platform.OS = 'ios';
  let listener: (event: KeyboardEvent) => void = () => {};
  const remove = jest.fn();
  const add = jest.spyOn(Keyboard, 'addListener').mockImplementation((_name, callback) => { listener = callback; return { remove } as unknown as ReturnType<typeof Keyboard.addListener>; });
  const schedule = jest.spyOn(Keyboard, 'scheduleLayoutAnimation').mockImplementation(() => {});
  try {
    const view = await render(<Probe />);
    const event = { duration: 250 } as KeyboardEvent;
    listener(event);
    expect(schedule).toHaveBeenCalledWith(event);
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    mockReducedMotion.mockReturnValue(true);
    add.mockClear();
    const reduced = await render(<Probe />);
    expect(add).not.toHaveBeenCalled();
    await reduced.unmount();
  } finally { Platform.OS = platform; mockReducedMotion.mockReturnValue(false); jest.restoreAllMocks(); }
});
