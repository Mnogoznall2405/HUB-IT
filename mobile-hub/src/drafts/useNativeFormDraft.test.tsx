import { useState } from 'react';
import { TextInput, Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNativeFormDraft } from './useNativeFormDraft';
import { clearNativeFormDrafts, createNativeFormDraftSession } from './nativeFormDrafts';
const mockStore = new Map<string, string>();
jest.mock('../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => mockStore.get(`${user}:${scope}`) || null),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number, data: string) => { mockStore.set(`${user}:${scope}`, data); return true; }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => { mockStore.delete(`${user}:${scope}`); }),
}));
function Form({ owner }: { owner: number }) {
  const [body, setBody] = useState('');
  const draft = useNativeFormDraft({ userId: owner, scope: 'test-form', ready: true, state: { body }, restore: (saved) => setBody(saved.body) });
  return <View><TextInput testID="body" value={body} onChangeText={setBody} /><Text>{draft.restored ? 'ready' : 'loading'}</Text></View>;
}
function ExternalForm({ owner, body }: { owner: number; body: string }) {
  const draft = useNativeFormDraft({ userId: owner, scope: 'external-form', ready: true, state: { body }, restore: () => undefined });
  return <Text>{draft.restored ? 'ready' : 'loading'}</Text>;
}

it('does not copy restored fields to another user and flushes the last edit on normal unmount', async () => {
  await clearNativeFormDrafts();
  await createNativeFormDraftSession(1, 'test-form').write({ body: 'Owner one private draft' });
  const view = await render(<Form owner={1} />);
  await waitFor(() => expect(view.getByTestId('body').props.value).toBe('Owner one private draft'));
  await view.rerender(<Form owner={2} />);
  await waitFor(() => expect(view.getByTestId('body').props.value).toBe(''));
  await fireEvent.changeText(view.getByTestId('body'), 'Owner two last keystroke');
  await view.unmount();
  expect(await createNativeFormDraftSession(2, 'test-form').read()).toEqual({ body: 'Owner two last keystroke' });
  expect(await createNativeFormDraftSession(1, 'test-form').read()).toEqual({ body: 'Owner one private draft' });
});

it('flushes the departing owner snapshot even when a new owner and new fields arrive in the same render', async () => {
  await clearNativeFormDrafts();
  const view = await render(<ExternalForm owner={1} body="Owner one" />);
  await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
  await view.rerender(<ExternalForm owner={2} body="Owner two" />);
  await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
  await view.unmount();
  expect(await createNativeFormDraftSession(1, 'external-form').read()).toEqual({ body: 'Owner one' });
  expect(await createNativeFormDraftSession(2, 'external-form').read()).toEqual({ body: 'Owner two' });
});
