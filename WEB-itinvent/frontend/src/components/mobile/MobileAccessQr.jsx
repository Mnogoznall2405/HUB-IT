import { useEffect, useState } from 'react';
import AndroidRoundedIcon from '@mui/icons-material/AndroidRounded';
import AppleIcon from '@mui/icons-material/Apple';
import useMobileInstallerFeed from '../../hooks/useMobileInstallerFeed';
import { buildQrDataUrl } from '../../lib/qrCodeImage';
import './MobileAccessQr.css';

const FALLBACK_PORTAL_URL = 'https://hubit.zsgp.ru/';

function resolvePortalUrl() {
  if (typeof window === 'undefined') return FALLBACK_PORTAL_URL;
  try {
    const origin = new URL(window.location.origin);
    return origin.protocol === 'https:' ? origin.origin + '/' : FALLBACK_PORTAL_URL;
  } catch {
    return FALLBACK_PORTAL_URL;
  }
}

function useQrDataUrl(target) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let active = true;
    setDataUrl('');
    if (!target) {
      return () => {
        active = false;
      };
    }
    buildQrDataUrl(target)
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [target]);

  return dataUrl;
}

function QrFrame({ dataUrl, alt }) {
  if (!dataUrl) {
    return (
      <div className="mobile-access-qr__image mobile-access-qr__image--pending" role="status" aria-live="polite">
        <span>Готовим QR-код…</span>
      </div>
    );
  }
  return (
    <div className="mobile-access-qr__image">
      <img src={dataUrl} alt={alt} width="148" height="148" decoding="async" />
    </div>
  );
}

export default function MobileAccessQr() {
  const state = useMobileInstallerFeed();
  const portalUrl = resolvePortalUrl();
  const androidUrl = state.status === 'ready' ? state.feed.downloadUrl : '';
  const androidQr = useQrDataUrl(androidUrl);
  const iphoneQr = useQrDataUrl(portalUrl);

  return (
    <div className="mobile-access-qr" aria-label="QR-коды для входа с телефона">
      <article className="mobile-access-qr__card">
        <span className="mobile-access-qr__icon" aria-hidden="true">
          <AndroidRoundedIcon fontSize="small" />
        </span>
        <h3>Android</h3>
        {state.status === 'unavailable' ? (
          <p className="mobile-access-qr__hint" role="status">
            Ссылка на APK сейчас недоступна — попробуйте позже.
          </p>
        ) : (
          <>
            <QrFrame dataUrl={androidQr} alt="QR-код со ссылкой на скачивание приложения HUB-IT для Android" />
            <p className="mobile-access-qr__hint">Наведите камеру телефона — начнётся загрузка приложения.</p>
            {androidUrl ? (
              <a className="mobile-access-qr__link" href={androidUrl}>
                Или скачать APK по ссылке
              </a>
            ) : null}
          </>
        )}
      </article>

      <article className="mobile-access-qr__card">
        <span className="mobile-access-qr__icon" aria-hidden="true">
          <AppleIcon fontSize="small" />
        </span>
        <h3>iPhone</h3>
        <QrFrame dataUrl={iphoneQr} alt="QR-код со ссылкой на HUB-IT для открытия на iPhone" />
        <p className="mobile-access-qr__hint">
          Откроется HUB в Safari. Добавьте на экран «Домой» через меню «Поделиться».
        </p>
        <a className="mobile-access-qr__link" href={portalUrl}>
          Или открыть HUB по ссылке
        </a>
      </article>
    </div>
  );
}
