import { useEffect, useState } from 'react';

import { getHubitPasskeyPlugin } from '../lib/hubitPasskeyNative';
import { isCapacitorNativeRuntime } from '../lib/useWebAuthnAvailability';

export default function PasskeyDiagnosticsPanel({
  webAuthnReady,
  webAuthnWebApiReady,
  webAuthnNativeReady,
  webAuthnTimedOut,
  networkZone,
  biometricLoginEnabled,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isCapacitorNativeRuntime()) {
      setVisible(false);
      return;
    }
    const debugFlag = typeof window !== 'undefined'
      && window.localStorage?.getItem('hubit:passkey-debug') === '1';
    setVisible(Boolean(debugFlag || webAuthnTimedOut || (!webAuthnReady && biometricLoginEnabled)));
  }, [webAuthnReady, webAuthnTimedOut, biometricLoginEnabled]);

  if (!visible || !isCapacitorNativeRuntime()) {
    return null;
  }

  const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
  const platform = String(capacitor?.getPlatform?.() || capacitor?.platform || 'unknown');
  const secure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasPlugin = Boolean(getHubitPasskeyPlugin());
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div
      data-testid="passkey-diagnostics"
      className="rounded-[18px] border border-amber-300/20 bg-amber-400/[0.08] p-3 text-left text-xs leading-5 text-amber-50/90"
    >
      <div className="font-semibold text-amber-100">Диагностика passkey (Android)</div>
      <div>platform: {platform}</div>
      <div>origin: {origin}</div>
      <div>secure: {secure ? 'yes' : 'no'}</div>
      <div>network: {networkZone || 'unknown'}</div>
      <div>biometric_login_enabled: {biometricLoginEnabled ? 'yes' : 'no'}</div>
      <div>PublicKeyCredential: {webAuthnWebApiReady ? 'yes' : 'no'}</div>
      <div>HubitPasskey plugin: {hasPlugin ? 'yes' : 'no'}</div>
      <div>native passkey: {webAuthnNativeReady ? 'yes' : 'no'}</div>
      <div>passkey ready: {webAuthnReady ? 'yes' : 'no'}</div>
      <div>timed out: {webAuthnTimedOut ? 'yes' : 'no'}</div>
      <p className="mt-2 text-amber-100/75">
        Если PublicKeyCredential = no, обновите Android System WebView. При native passkey = yes вход идёт через Credential Manager.
      </p>
    </div>
  );
}
