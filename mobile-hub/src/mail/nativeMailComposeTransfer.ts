import * as Crypto from 'expo-crypto';

type Transfer = { userId: number; mailboxId: string; messageId: string; text: string; expiresAt: number; onTaken?: () => void; onSaved?: () => Promise<void> };
// Short-lived handoff only; the source screen retains its text until it is sent.
const transfers = new Map<string, Transfer>();
const taken = new Map<string, Transfer>();
export function createMailComposeTransfer(value: Omit<Transfer, 'expiresAt'>): string {
  const key = Crypto.randomUUID?.() || `mail-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (const [id, entry] of transfers) if (entry.expiresAt <= Date.now()) transfers.delete(id);
  for (const [id, entry] of taken) if (entry.expiresAt <= Date.now()) taken.delete(id);
  while (taken.size >= 8) taken.delete(taken.keys().next().value!);
  while (transfers.size >= 8) transfers.delete(transfers.keys().next().value!);
  transfers.set(key, { ...value, expiresAt: Date.now() + 5 * 60_000 });
  return key;
}
export function takeMailComposeTransfer(key: string, scope: Pick<Transfer, 'userId' | 'mailboxId' | 'messageId'>): string | null {
  const entry = transfers.get(key);
  if (!entry || entry.expiresAt <= Date.now()) { transfers.delete(key); return null; }
  if (entry.userId !== scope.userId || entry.mailboxId !== scope.mailboxId || entry.messageId !== scope.messageId) return null;
  transfers.delete(key);
  if (entry.onSaved) taken.set(key, entry);
  entry.onTaken?.();
  return entry.text;
}

export async function acknowledgeMailComposeTransfer(key: string, userId: number): Promise<void> {
  const entry = taken.get(key);
  if (!entry || entry.userId !== userId) return;
  await entry.onSaved?.();
  taken.delete(key);
}

export function clearMailComposeTransfers(): void { transfers.clear(); taken.clear(); }
