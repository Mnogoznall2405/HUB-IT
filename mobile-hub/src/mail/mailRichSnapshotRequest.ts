export type MailRichSnapshot = { html: string; text: string };
let nextRequestId = 0;

export function createMailRichSnapshotRequest() {
  let pending: { id: number; resolve: (value: MailRichSnapshot) => void; reject: (cause: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancel = () => {
    if (!pending) return;
    const request = pending; pending = null;
    clearTimeout(request.timer);
    request.reject(new Error('Не удалось получить последнюю версию письма. Повторите действие.'));
  };
  return {
    request(inject: (id: number) => void): Promise<MailRichSnapshot> {
      if (pending) return Promise.reject(new Error('Дождитесь завершения предыдущего действия.'));
      return new Promise((resolve, reject) => {
        const id = ++nextRequestId;
        pending = { id, resolve, reject, timer: setTimeout(cancel, 3500) };
        try { inject(id); } catch { cancel(); }
      });
    },
    receive(value: unknown): boolean {
      if (!pending || !value || typeof value !== 'object') return false;
      const event = value as Record<string, unknown>;
      if (event.type !== 'snapshot' || event.id !== pending.id) return false;
      if (typeof event.html !== 'string' || typeof event.text !== 'string' || event.html.length > 2_000_000 || event.text.length > 2_000_000) {
        cancel(); return true;
      }
      const request = pending; pending = null; clearTimeout(request.timer);
      request.resolve({ html: event.html, text: event.text });
      return true;
    },
    cancel,
  };
}
