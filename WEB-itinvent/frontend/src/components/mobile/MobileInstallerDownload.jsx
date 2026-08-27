import AndroidRoundedIcon from '@mui/icons-material/AndroidRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useId } from 'react';
import useMobileInstallerFeed from '../../hooks/useMobileInstallerFeed';
import { formatMobileInstallerSize } from '../../lib/mobileInstallerFeed';
import '../desktop/DesktopInstallerDownload.css';
import './MobileInstallerDownload.css';

export default function MobileInstallerDownload({ variant = 'default' }) {
  const metadataId = useId();
  const state = useMobileInstallerFeed();
  const rootClassName = `desktop-installer-download desktop-installer-download--${variant} mobile-installer-download`;

  if (state.status === 'ready') {
    const sizeLabel = formatMobileInstallerSize(state.feed.sizeBytes);
    return (
      <div className={rootClassName} data-testid="mobile-installer-ready">
        <a
          className="desktop-installer-download__button"
          href={state.feed.downloadUrl}
          download
          aria-describedby={metadataId}
        >
          <DownloadRoundedIcon fontSize="small" aria-hidden="true" />
          Скачать для Android
        </a>
        <span id={metadataId} className="desktop-installer-download__meta">
          Android 7.0+ · тестовая версия {state.feed.version}{sizeLabel ? ` · ${sizeLabel}` : ''}
        </span>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className={rootClassName} data-testid="mobile-installer-unavailable" role="status" aria-live="polite">
        <span className="desktop-installer-download__icon" aria-hidden="true">
          <InfoOutlinedIcon fontSize="small" />
        </span>
        <span className="desktop-installer-download__copy">
          <span className="desktop-installer-download__title">APK временно недоступен</span>
          <span className="desktop-installer-download__meta">Веб-версия HUB-IT продолжает работать.</span>
        </span>
      </div>
    );
  }

  return (
    <div className={rootClassName} data-testid="mobile-installer-loading" role="status" aria-live="polite">
      <span className="desktop-installer-download__icon" aria-hidden="true">
        <AndroidRoundedIcon fontSize="small" />
      </span>
      <span className="desktop-installer-download__copy">
        <span className="desktop-installer-download__title">HUB-IT для Android</span>
        <span className="desktop-installer-download__meta">Проверяем актуальную версию APK.</span>
      </span>
    </div>
  );
}
