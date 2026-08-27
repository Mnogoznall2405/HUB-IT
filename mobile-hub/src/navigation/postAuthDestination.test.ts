import { postAuthDestination } from './postAuthDestination';
import {
  clearPendingPortalPathForTests,
  rememberSystemIntentDestination,
} from './systemIntent';

beforeEach(clearPendingPortalPathForTests);

describe('postAuthDestination', () => {
  it('opens the native dashboard after Android authentication', () => {
    expect(postAuthDestination('android', '/(shell)/dashboard')).toEqual({
      pathname: '/(shell)/dashboard',
    });
  });

  it('keeps the Expo web fallback used by browser-only prototype tests', () => {
    expect(postAuthDestination('web', '/(shell)/dashboard')).toBe('/(shell)/dashboard');
  });
});

it('reduces a legacy Android portal link to its native destination after authentication', () => {
  rememberSystemIntentDestination('/web?path=%2Ftasks%3Fview%3Dmine');
  expect(postAuthDestination('android', '/dashboard')).toEqual({ pathname: '/(shell)/tasks' });
  expect(postAuthDestination('android', '/dashboard')).toEqual({
    pathname: '/(shell)/dashboard',
  });
});

it('restores a native task detail after Android authentication', () => {
  rememberSystemIntentDestination('/tasks/task-42');
  expect(postAuthDestination('android', '/dashboard')).toEqual({
    pathname: '/(shell)/tasks/[taskId]',
    params: { taskId: 'task-42' },
  });
});
