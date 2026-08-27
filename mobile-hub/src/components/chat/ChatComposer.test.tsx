import { fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ChatComposer } from './ChatComposer';

const mockUseReducedMotion = jest.fn(() => false);

jest.mock('../../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

async function renderComposer(onSend = jest.fn()) {
  return {
    onSend,
    view: await render(
      <ChatComposer
        value="Сообщение из поля"
        onChangeText={jest.fn()}
        onSend={onSend}
      />,
    ),
  };
}

describe('ChatComposer send transition', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
    jest.spyOn(Animated, 'timing').mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps a visual text snapshot while the outgoing bubble enters the thread', async () => {
    const { onSend, view } = await renderComposer();

    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('chat-composer-send-ghost', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByText('Сообщение из поля', { includeHiddenElements: true })).toBeTruthy();
  });

  it('does not create movement when reduced motion is enabled', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { view } = await renderComposer();

    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    expect(view.queryByTestId('chat-composer-send-ghost')).toBeNull();
  });
});
