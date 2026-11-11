import { Linking } from 'react-native';
import { normalizePhoneDigits, normalizeText } from './addressBookFormat';

export function isPhoneDeepLinkReady(digits: unknown): boolean {
  return /^\d{11,15}$/.test(normalizeText(digits));
}

export function buildTelegramDeepLinks(phoneDigits: unknown, text = ''): { appLink: string; webLink: string } | null {
  const digits = normalizePhoneDigits(phoneDigits);
  if (!isPhoneDeepLinkReady(digits)) return null;
  const encodedText = encodeURIComponent(normalizeText(text));
  const textSuffix = encodedText ? `?text=${encodedText}` : '';
  const textAmp = encodedText ? `&text=${encodedText}` : '';
  return {
    appLink: `tg://resolve?phone=${digits}${textAmp}`,
    webLink: `https://t.me/+${digits}${textSuffix}`,
  };
}

export async function openTelegramChat(phoneDigits: unknown, text = ''): Promise<boolean> {
  const links = buildTelegramDeepLinks(phoneDigits, text);
  if (!links) return false;
  try {
    await Linking.openURL(links.appLink);
    return true;
  } catch {
    try {
      await Linking.openURL(links.webLink);
      return true;
    } catch {
      return false;
    }
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const href = normalizeText(url);
  if (!href) return false;
  try {
    await Linking.openURL(href);
    return true;
  } catch {
    return false;
  }
}
