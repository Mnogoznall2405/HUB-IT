import { useId, useState } from 'react';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LaptopWindowsRoundedIcon from '@mui/icons-material/LaptopWindowsRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { requestDesktopCheckForUpdates } from '../../lib/desktopBridge';
import { isNativeShellRuntime } from '../../lib/platform';
import {
  detectDesktopDownloadPlatform,
  formatInstallerSize,
} from '../../lib/desktopInstallerFeed';
import useDesktopInstallerFeed from '../../hooks/useDesktopInstallerFeed';
import './DesktopInstallerDownload.css';

export default function DesktopInstallerDownload({ variant = 'default' }) {
  const metadataId = useId();
  const nativeShell = isNativeShellRuntime();
  const platform = detectDesktopDownloadPlatform();
  const enabled = !nativeShell && platform.supported;
  const state = useDesktopInstallerFeed({ enabled });
  const [nativeActionError, setNativeActionError] = useState('');
  const rootClassName = `desktop-installer-download desktop-installer-download--${variant}`;

  if (nativeShell && variant !== 'settings') return null;

  if (nativeShell) {
    const handleCheckForUpdates = () => {
      const accepted = requestDesktopCheckForUpdates();
      setNativeActionError(accepted
        ? ''
        : 'Не удалось открыть проверку обновлений. Используйте пункт «О программе и обновления» в меню HUB Desktop.');
    };

    return (
      <div className={rootClassName} data-testid="desktop-installer-native">
        <span className="desktop-installer-download__icon" aria-hidden="true">
          <LaptopWindowsRoundedIcon fontSize="small" />
        </span>
        <span className="desktop-installer-download__copy">
          <span className="desktop-installer-download__title">HUB Desktop для Windows</span>
          <span className="desktop-installer-download__meta">
            HUB Desktop проверяет обновления автоматически. Здесь можно запустить проверку вручную.
          </span>
          <span
            className="desktop-installer-download__status desktop-installer-download__status--error"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {nativeActionError}
          </span>
        </span>
        <button
          type="button"
          className="desktop-installer-download__button"
          onClick={handleCheckForUpdates}
        >
          <RefreshRoundedIcon fontSize="small" aria-hidden="true" />
          Проверить обновления
        </button>
      </div>
    );
  }

  if (!platform.supported) {
    return (
      <div className={rootClassName} data-testid="desktop-installer-unsupported">
        <span className="desktop-installer-download__icon" aria-hidden="true">
          <LaptopWindowsRoundedIcon fontSize="small" />
        </span>
        <span className="desktop-installer-download__copy">
          <span className="desktop-installer-download__title">HUB Desktop для Windows</span>
          <span className="desktop-installer-download__meta">Откройте эту страницу на компьютере с Windows.</span>
        </span>
      </div>
    );
  }

  if (state.status === 'ready') {
    const sizeLabel = formatInstallerSize(state.feed.sizeBytes);
    return (
      <div className={rootClassName} data-testid="desktop-installer-ready">
        <a
          className="desktop-installer-download__button"
          href={state.feed.downloadUrl}
          download
          aria-describedby={metadataId}
        >
          <DownloadRoundedIcon fontSize="small" aria-hidden="true" />
          Скачать для Windows
        </a>
        <span id={metadataId} className="desktop-installer-download__meta">
          Windows 10/11 · x64 · версия {state.feed.version}{sizeLabel ? ` · ${sizeLabel}` : ''}
        </span>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className={rootClassName} data-testid="desktop-installer-unavailable" role="status" aria-live="polite">
        <span className="desktop-installer-download__icon" aria-hidden="true">
          <InfoOutlinedIcon fontSize="small" />
        </span>
        <span className="desktop-installer-download__copy">
          <span className="desktop-installer-download__title">Загрузка временно недоступна</span>
          <span className="desktop-installer-download__meta">Вход в HUB-IT продолжает работать.</span>
        </span>
      </div>
    );
  }

  return (
    <div className={rootClassName} data-testid="desktop-installer-loading" role="status" aria-live="polite">
      <span className="desktop-installer-download__spinner" aria-hidden="true" />
      <span className="desktop-installer-download__copy">
        <span className="desktop-installer-download__title">Проверяем актуальную версию</span>
        <span className="desktop-installer-download__meta">Это займёт несколько секунд.</span>
      </span>
    </div>
  );
}
