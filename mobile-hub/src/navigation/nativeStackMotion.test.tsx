import { render } from '@testing-library/react-native';
import AuthLayout from '../../app/(auth)/_layout';
import TasksLayout from '../../app/(shell)/tasks/_layout';
import MailLayout from '../../app/(shell)/mail/_layout';
import ChatLayout from '../../app/(shell)/chat/_layout';

let mockReduced = false;
jest.mock('../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Stack: (props: object) => React.createElement(View, { ...props, testID: 'native-stack' }) };
});
it.each([AuthLayout, TasksLayout, MailLayout, ChatLayout])('updates stack motion without changing the navigation content', async (Layout) => {
  mockReduced = false;
  const view = await render(<Layout />);
  const original = view.getByTestId('native-stack').props.screenOptions;
  expect(original.animation).toBe('slide_from_right');
  mockReduced = true;
  await view.rerender(<Layout />);
  expect(view.getByTestId('native-stack').props.screenOptions).toEqual({ ...original, animation: 'none' });
});
