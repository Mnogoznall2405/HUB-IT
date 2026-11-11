import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  getChatAttachmentTransfer,
  setChatAttachmentTransfer,
  subscribeChatAttachmentTransfers,
  syncChatAttachmentTransfers,
  useChatAttachmentTransfer,
} from './nativeChatAttachmentTransfers';

function Probe({ id }: { id: string }) {
  const transfer = useChatAttachmentTransfer(id);
  return <Text testID={`probe-${id}`}>{transfer ? `${transfer.status}:${transfer.progress}` : 'idle'}</Text>;
}

beforeEach(() => { syncChatAttachmentTransfers({}); });

it('emits to row subscribers only when the transfer actually changes', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeChatAttachmentTransfers(listener);
  const view = await render(<Probe id="a1" />);
  expect(view.getByTestId('probe-a1').props.children).toBe('idle');

  await act(async () => { setChatAttachmentTransfer('a1', { action: 'upload', progress: 0.4, status: 'active', cancellable: true }); });
  expect(view.getByTestId('probe-a1').props.children).toBe('active:0.4');
  expect(listener).toHaveBeenCalledTimes(1);

  await act(async () => { setChatAttachmentTransfer('a1', { action: 'upload', progress: 0.4, status: 'active', cancellable: true }); });
  expect(listener).toHaveBeenCalledTimes(1);

  await act(async () => { setChatAttachmentTransfer('a1', { action: 'upload', progress: 0.9, status: 'active', cancellable: true }); });
  expect(view.getByTestId('probe-a1').props.children).toBe('active:0.9');
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('updates only the subscribed row while another attachment stays idle', async () => {
  const view = await render(<><Probe id="a1" /><Probe id="a2" /></>);
  await act(async () => { setChatAttachmentTransfer('a1', { action: 'upload', progress: 0.5, status: 'active', cancellable: true }); });
  expect(view.getByTestId('probe-a1').props.children).toBe('active:0.5');
  expect(view.getByTestId('probe-a2').props.children).toBe('idle');
});

it('keeps a fresher progress tick when the coarser status map syncs behind', () => {
  act(() => { setChatAttachmentTransfer('b1', { action: 'upload', progress: 0.9, status: 'active', cancellable: true }); });
  act(() => { syncChatAttachmentTransfers({ b1: { action: 'upload', progress: 0.1, status: 'active', cancellable: true } }); });
  expect(getChatAttachmentTransfer('b1')?.progress).toBe(0.9);
});

it('applies status transitions from the map and prunes removed ids', () => {
  act(() => { setChatAttachmentTransfer('b2', { action: 'upload', progress: 0.9, status: 'active', cancellable: true }); });
  act(() => { syncChatAttachmentTransfers({ b2: { action: 'upload', progress: 0.9, status: 'cancelled', cancellable: false } }); });
  expect(getChatAttachmentTransfer('b2')).toMatchObject({ status: 'cancelled', progress: 0.9 });
  act(() => { syncChatAttachmentTransfers({}); });
  expect(getChatAttachmentTransfer('b2')).toBeUndefined();
});
