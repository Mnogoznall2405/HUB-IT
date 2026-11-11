jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-transfer-key' }));
import { acknowledgeMailComposeTransfer, createMailComposeTransfer, takeMailComposeTransfer } from './nativeMailComposeTransfer';
const scope = { userId: 7, mailboxId: 'box', messageId: 'message' };
it('keeps the durable source until the editor acknowledges a successful save', async () => {
  const onSaved = jest.fn(async () => undefined);
  const key = createMailComposeTransfer({ ...scope, text: 'Черновик', onSaved });
  takeMailComposeTransfer(key, scope);
  expect(onSaved).not.toHaveBeenCalled();
  await acknowledgeMailComposeTransfer(key, 8);
  expect(onSaved).not.toHaveBeenCalled();
  await acknowledgeMailComposeTransfer(key, 7);
  await acknowledgeMailComposeTransfer(key, 7);
  expect(onSaved).toHaveBeenCalledTimes(1);
});
it('keeps text out of the token, isolates scope and consumes it once', () => {
  const text = 'Синтетический ответ\nВторая строка';
  const onTaken = jest.fn();
  const key = createMailComposeTransfer({ ...scope, text, onTaken });
  expect(key).not.toContain(text);
  expect(takeMailComposeTransfer(key, { ...scope, userId: 8 })).toBeNull();
  expect(takeMailComposeTransfer(key, { ...scope, mailboxId: 'other' })).toBeNull();
  expect(takeMailComposeTransfer(key, { ...scope, messageId: 'other' })).toBeNull();
  expect(onTaken).not.toHaveBeenCalled();
  expect(takeMailComposeTransfer(key, scope)).toBe(text);
  expect(onTaken).toHaveBeenCalledTimes(1);
  expect(takeMailComposeTransfer(key, scope)).toBeNull();
});
it('rejects expired transfers', () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const key = createMailComposeTransfer({ ...scope, text: 'synthetic' });
  now.mockReturnValue(301001);
  expect(takeMailComposeTransfer(key, scope)).toBeNull();
  now.mockRestore();
});
