import { fireEvent, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ChatFolderTabs } from './ChatFolderTabs';

const mockReduced = jest.fn(() => false);
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));
afterEach(() => { jest.restoreAllMocks(); mockReduced.mockReturnValue(false); });

it.each([false, true])('reveals a folder selected by a page swipe (reduced motion %s)', async (reduced) => {
  mockReduced.mockReturnValue(reduced);
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const onFolderChange = jest.fn();
  const view = await render(<ChatFolderTabs activeFolderKey="personal" onFolderChange={onFolderChange} />);
  await fireEvent(view.getByTestId('chat-folder-tabs'), 'layout', { nativeEvent: { layout: { width: 320 } } });
  await fireEvent(view.getByRole('tab', { name: 'Папка Задачи' }), 'layout', { nativeEvent: { layout: { x: 400, width: 100 } } });
  expect(scroll).not.toHaveBeenCalled();
  await view.rerender(<ChatFolderTabs activeFolderKey="tasks" onFolderChange={onFolderChange} />);
  expect(scroll).toHaveBeenCalledWith({ x: 188, animated: !reduced });
  expect(view.getByRole('tab', { name: 'Папка Задачи' }).props.accessibilityState.selected).toBe(true);
  expect(onFolderChange).not.toHaveBeenCalled();
});

it('keeps visible tabs still and preserves direct selection with unread labels', async () => {
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const change = jest.fn();
  const view = await render(<ChatFolderTabs activeFolderKey="personal" onFolderChange={change} unreadCounts={{ unread: 4 }} />);
  await fireEvent(view.getByTestId('chat-folder-tabs'), 'layout', { nativeEvent: { layout: { width: 320 } } });
  await fireEvent(view.getByRole('tab', { name: 'Папка Личные' }), 'layout', { nativeEvent: { layout: { x: 8, width: 90 } } });
  expect(scroll).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('tab', { name: 'Папка Непрочитанные, непрочитанных 4' }));
  expect(change).toHaveBeenCalledWith('unread');
});
