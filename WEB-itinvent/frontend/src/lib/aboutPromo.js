const PROMO_STORAGE_PREFIX = 'hubit.about-promo.dismissed.v1.';

const promoKey = (userId) => `${PROMO_STORAGE_PREFIX}${String(userId ?? '')}`;

export function isAboutPromoDismissed(userId) {
  if (userId === undefined || userId === null || typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(promoKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function dismissAboutPromo(userId) {
  if (userId === undefined || userId === null || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(promoKey(userId), '1');
  } catch {
    // Хранилище недоступно: карточка просто покажется снова.
  }
}
