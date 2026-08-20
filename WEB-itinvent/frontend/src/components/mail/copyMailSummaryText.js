export async function copyMailSummaryText(text, {
  clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
  onSuccess,
  onError,
} = {}) {
  try {
    await clipboard.writeText(String(text || ''));
    onSuccess?.('Пересказ скопирован.');
    return true;
  } catch {
    onError?.('Не удалось скопировать пересказ.');
    return false;
  }
}
