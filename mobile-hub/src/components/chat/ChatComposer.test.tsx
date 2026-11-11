import { act, fireEvent, render } from '@testing-library/react-native';
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

  it('sends without drawing a duplicate text over the real outgoing bubble', async () => {
    const { onSend, view } = await renderComposer();

    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('chat-composer-send-ghost', { includeHiddenElements: true })).toBeNull();
    expect(view.getByLabelText('Текст сообщения').props.value).toBe('Сообщение из поля');
  });

  it('does not create movement when reduced motion is enabled', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { view } = await renderComposer();

    await fireEvent.press(view.getByLabelText('Отправить сообщение'));

    expect(view.queryByTestId('chat-composer-send-ghost')).toBeNull();
  });
});

it('blocks a double tap on the same draft but accepts the next message immediately', async () => {
  const onSend = jest.fn();
  const props = { onChangeText: jest.fn(), onSend };
  const view = await render(<ChatComposer {...props} value="first" />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(1);
  await view.rerender(<ChatComposer {...props} value="second" />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(2);
});

it('opens the source from the reply panel and cancels reply independently', async () => {
  const onOpenContext = jest.fn();
  const onCancelMode = jest.fn();
  const view = await render(<ChatComposer value="reply" onSend={jest.fn()} onChangeText={jest.fn()} mode="reply" contextPreview="source" onOpenContext={onOpenContext} onCancelMode={onCancelMode} />);
  await fireEvent.press(view.getByLabelText('Перейти к исходному сообщению'));
  await fireEvent.press(view.getByLabelText('Отменить ответ'));
  expect(onOpenContext).toHaveBeenCalledTimes(1);
  expect(onCancelMode).toHaveBeenCalledTimes(1);
});

it('blocks microphone and edit cancellation while saving', async () => {
  const onMicPress = jest.fn();
  const onCancelMode = jest.fn();
  const props = { onChangeText: jest.fn(), onSend: jest.fn(), onMicPress, onCancelMode, busy: true };
  const view = await render(<ChatComposer {...props} value="" />);
  await fireEvent.press(view.getByLabelText('Записать голосовое'));
  expect(onMicPress).not.toHaveBeenCalled();
  await view.rerender(<ChatComposer {...props} value="edit" mode="edit" />);
  await fireEvent.press(view.getByLabelText('Отменить редактирование'));
  expect(onCancelMode).not.toHaveBeenCalled();
});

it('allows retry of unchanged text after the asynchronous send attempt ends', async () => {
  let finish!: () => void;
  const onSend = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = await render(<ChatComposer value="keep draft" onSend={onSend} onChangeText={jest.fn()} />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(2);
});

it('does not release a newer send when an earlier attempt finishes', async () => {
  const finish: (() => void)[] = [];
  const onSend = jest.fn(() => new Promise<void>((resolve) => { finish.push(resolve); }));
  const props = { onSend, onChangeText: jest.fn() };
  const view = await render(<ChatComposer {...props} value="first" />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  await view.rerender(<ChatComposer {...props} value="second" />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  await act(async () => { finish[0](); });
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(2);
});

it('does not unlock the same pending attempt when busy toggles before its promise completes', async () => {
  let finish!: () => void;
  const onSend = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const props = { value: 'same draft', onSend, onChangeText: jest.fn() };
  const view = await render(<ChatComposer {...props} />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  await view.rerender(<ChatComposer {...props} busy />);
  await view.rerender(<ChatComposer {...props} busy={false} />);
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  await fireEvent.press(view.getByLabelText('Отправить сообщение'));
  expect(onSend).toHaveBeenCalledTimes(2);
});
