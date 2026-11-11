type SessionExpiredHandler = () => void;

const handlers = new Set<SessionExpiredHandler>();

export function subscribeSessionExpired(handler: SessionExpiredHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function publishSessionExpired(): void {
  handlers.forEach((handler) => handler());
}
