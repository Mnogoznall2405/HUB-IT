const REASON_LABELS = {
  'ocr returned no text for a nonblank page': 'OCR не распознал текст на непустой странице',
  'ocr execution error': 'Ошибка выполнения OCR',
  'one or more ocr pages were not fully analyzed': 'Одна или несколько страниц OCR проанализированы не полностью',
  'skipped ocr: blank/tiny pdf': 'OCR пропущен: пустой или слишком маленький PDF',
  'ocr confirmed blank pages': 'OCR подтвердил пустые страницы',
  'ocr text had no pattern matches': 'В тексте OCR не найдено совпадений с правилами',
  'no pdf payload': 'Нет данных PDF',
  'analysis incomplete': 'Анализ не завершён',
  'ocr analysis incomplete': 'Анализ OCR не завершён',
  'missing transient pdf payload': 'Отсутствует временный файл PDF на сервере',
  'analysis rules unavailable': 'Правила поиска недоступны',
  'document conversion incomplete': 'Преобразование документа не завершено',
  'ocr timeout': 'Превышено время OCR',
  pdf_slice_payload_too_large: 'Срез PDF слишком большой для передачи',
  document_payload_too_large: 'Документ слишком большой для передачи',
  pdf_slice_creation_failed: 'Не удалось сформировать срез PDF на агенте',
  patterns_unavailable: 'На агенте недоступны правила поиска',
  file_too_large: 'Файл превышает допустимый размер',
  agent_analysis_incomplete: 'Агент не завершил анализ файла',
};

export function friendlyScanReason(value) {
  const reason = String(value || '').trim();
  const normalized = reason.toLowerCase();
  if (!reason) return 'Анализ не завершён';
  if (REASON_LABELS[normalized]) return REASON_LABELS[normalized];
  for (const [key, label] of Object.entries(REASON_LABELS)) {
    if (normalized.includes(key)) return label;
  }
  if (normalized.includes('превышает') && normalized.includes('байт')) return reason;
  if (normalized.includes('timeout') || normalized.includes('время')) {
    return normalized.startsWith('превышено') ? reason : `Превышено время анализа: ${reason}`;
  }
  if (normalized.includes('payload') && normalized.includes('large')) return 'Файл превышает допустимый размер передачи';
  if (normalized.includes('payload')) return 'Не удалось получить файл';
  if (normalized.includes('encrypt') || normalized.includes('password') || normalized.includes('парол')) {
    return 'Файл зашифрован или защищён паролем';
  }
  if (normalized.includes('tesseract') || normalized.includes('ocr')) {
    return reason.startsWith('OCR') || reason.startsWith('Ошибка распознавания')
      ? reason
      : `Ошибка распознавания: ${reason}`;
  }
  if (normalized.includes('libreoffice') || normalized.includes('convert') || normalized.includes('преобразован')) {
    return reason.startsWith('Ошибка преобразования') ? reason : `Ошибка преобразования документа: ${reason}`;
  }
  return reason;
}
