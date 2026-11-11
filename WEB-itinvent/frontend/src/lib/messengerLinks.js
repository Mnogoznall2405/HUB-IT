const normalizeText = (value) => String(value || '').trim();

export const normalizePhoneDigits = (value) => {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

export const isPhoneDeepLinkReady = (digits) => /^\d{11,15}$/.test(normalizeText(digits));

export const buildTelegramDeepLinks = (phoneDigits, text = '') => {
  const digits = normalizePhoneDigits(phoneDigits);
  if (!isPhoneDeepLinkReady(digits)) return null;
  const encodedText = encodeURIComponent(normalizeText(text));
  const textSuffix = encodedText ? `?text=${encodedText}` : '';
  const textAmp = encodedText ? `&text=${encodedText}` : '';
  return {
    appLink: `tg://resolve?phone=${digits}${textAmp}`,
    webLink: `https://t.me/+${digits}${textSuffix}`,
  };
};

export const openTelegramChat = (phoneDigits, text = '') => {
  const links = buildTelegramDeepLinks(phoneDigits, text);
  if (!links) return false;
  let appHandled = false;
  const markHandled = () => {
    appHandled = true;
  };
  window.addEventListener('blur', markHandled, { once: true });
  window.addEventListener('pagehide', markHandled, { once: true });
  window.location.href = links.appLink;
  window.setTimeout(() => {
    window.removeEventListener('blur', markHandled);
    window.removeEventListener('pagehide', markHandled);
    if (appHandled || document.visibilityState === 'hidden') return;
    window.open(links.webLink, '_blank', 'noopener,noreferrer');
  }, 900);
  return true;
};

export const buildTelegramShareUrl = ({ url, text }) => {
  const params = new URLSearchParams();
  const normalizedUrl = normalizeText(url);
  const normalizedText = normalizeText(text);
  if (normalizedUrl) params.set('url', normalizedUrl);
  if (normalizedText) params.set('text', normalizedText);
  const query = params.toString();
  return query ? `https://t.me/share/url?${query}` : '';
};
