export const APP_BRAND_NAME = 'HUB-IT';
export const INVENTORY_SECTION_LABEL = 'Инвентарь';

export function buildDocumentTitle(sectionLabel) {
  const section = String(sectionLabel || '').trim();
  if (!section || section === APP_BRAND_NAME) {
    return APP_BRAND_NAME;
  }
  return `${section} — ${APP_BRAND_NAME}`;
}
