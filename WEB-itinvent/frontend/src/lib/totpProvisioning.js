function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const platform = String(navigator.platform || '').toLowerCase();
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  return /iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && maxTouchPoints > 1);
}

function isMacOsSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  const platform = String(navigator.platform || '');
  const isMac = /mac/i.test(platform) || /macintosh/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|YaBrowser/i.test(ua);
  return isMac && isSafari && !isIosLike();
}

export function alignOtpAuthAccountName(otpauthUri, accountName, { normalizeCase = false } = {}) {
  const normalized = String(otpauthUri || '').trim();
  let account = String(accountName || '').trim();
  if (normalizeCase) {
    account = account.toLowerCase();
  }
  if (!normalized.startsWith('otpauth://totp/') || !account) {
    return normalized;
  }
  const queryIndex = normalized.indexOf('?');
  const base = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  const query = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '';
  const pathPart = decodeURIComponent(base.slice('otpauth://totp/'.length));
  const colonIndex = pathPart.indexOf(':');
  const label = colonIndex >= 0 ? pathPart.slice(0, colonIndex) : pathPart;
  const encodedAccount = encodeURIComponent(account);
  return query
    ? `otpauth://totp/${label}:${encodedAccount}?${query}`
    : `otpauth://totp/${label}:${encodedAccount}`;
}

export function buildAppleFriendlyOtpAuthUri(otpauthUri, { issuerDomain = '', accountName = '' } = {}) {
  const normalized = String(otpauthUri || '').trim();
  if (!normalized.startsWith('otpauth://totp/')) {
    return normalized;
  }
  const queryIndex = normalized.indexOf('?');
  const query = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  const issuer = String(issuerDomain || params.get('issuer') || '').trim();
  const account = String(accountName || '').trim();
  if (!issuer || !account) {
    return normalized;
  }
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);
  const secret = params.get('secret') || '';
  const digits = params.get('digits') || '6';
  const period = params.get('period') || '30';
  const nextQuery = new URLSearchParams();
  if (secret) {
    nextQuery.set('secret', secret);
  }
  nextQuery.set('issuer', issuer);
  nextQuery.set('digits', digits);
  nextQuery.set('period', period);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?${nextQuery.toString()}`;
}

export function toAppleOtpAuthUri(otpauthUri) {
  const normalized = String(otpauthUri || '').trim();
  if (!normalized.startsWith('otpauth://')) {
    return normalized;
  }
  return `apple-otpauth://${normalized.slice('otpauth://'.length)}`;
}

export function isAppleKeychainOtpSupported() {
  return isIosLike() || isMacOsSafari();
}

export function isIosDevice() {
  return isIosLike();
}
