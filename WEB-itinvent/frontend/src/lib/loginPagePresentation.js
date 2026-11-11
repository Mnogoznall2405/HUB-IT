import { emitAgentDebugLog } from './debugClientLog';

function parseAlphaFromColor(colorValue) {
  const value = String(colorValue || '').trim();
  const rgbaMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (!rgbaMatch) {
    return value.includes('transparent') ? 0 : 1;
  }
  const parts = rgbaMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 4) {
    return 1;
  }
  const alpha = Number.parseFloat(parts[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}

export function auditLoginPageOverlays() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      bodyOverflow: '',
      htmlOverflow: '',
      overlays: [],
      orphanScrimsRemoved: 0,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const loginRoot = document.querySelector('[data-testid="login-mobile-layout"], [data-testid="login-desktop-layout"]');
  const overlays = [];

  document.querySelectorAll('body *').forEach((element) => {
    if (element.closest('[data-login-decorative="true"]')) {
      return;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return;
    }
    if (style.position !== 'fixed' && style.position !== 'absolute') {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < viewportWidth * 0.82 || rect.height < viewportHeight * 0.82) {
      return;
    }

    overlays.push({
      tag: element.tagName,
      testId: element.getAttribute('data-testid'),
      className: String(element.className || '').slice(0, 160),
      zIndex: style.zIndex,
      opacity: style.opacity,
      backgroundColor: style.backgroundColor,
      pointerEvents: style.pointerEvents,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  });

  return {
    bodyOverflow: document.body.style.overflow || '',
    htmlOverflow: document.documentElement.style.overflow || '',
    bodyComputedOverflow: window.getComputedStyle(document.body).overflow,
    htmlComputedOverflow: window.getComputedStyle(document.documentElement).overflow,
    loginRootFound: Boolean(loginRoot),
    userAgent: String(navigator.userAgent || '').slice(0, 160),
    overlays,
  };
}

export function removeOrphanLoginScrims(rootElement) {
  const roots = [];
  if (rootElement) {
    roots.push(rootElement);
  }
  if (typeof document !== 'undefined' && document.body) {
    roots.push(document.body);
  }

  let removed = 0;
  roots.forEach((scope) => {
    scope.querySelectorAll('button, div').forEach((element) => {
      if (element.closest('[data-testid="login-top-notice"]')) {
        return;
      }
      const className = String(element.className || '');
      const style = window.getComputedStyle(element);
      if (style.position !== 'fixed' && style.position !== 'absolute') {
        return;
      }
      const rect = element.getBoundingClientRect();
      const coversViewport = rect.width >= window.innerWidth * 0.9
        && rect.height >= window.innerHeight * 0.9;
      if (!coversViewport) {
        return;
      }

      const isLegacyScrim = className.includes('bg-black/')
        || className.includes('bg-black\\/')
        || (parseAlphaFromColor(style.backgroundColor) < 0.92
          && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
          && String(element.getAttribute('data-testid') || '').includes('backdrop'));
      if (!isLegacyScrim) {
        return;
      }

      element.remove();
      removed += 1;
    });
  });

  return removed;
}

export function resetLoginPagePresentation({
  focusUsername = false,
  logContext = 'reset',
  hypothesisId = 'H4',
} = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { orphanScrimsRemoved: 0, overlays: [] };
  }

  document.body.style.overflow = '';
  document.body.style.pointerEvents = '';
  document.documentElement.style.overflow = '';
  document.documentElement.style.removeProperty('filter');
  document.body.style.removeProperty('filter');

  const loginRoot = document.querySelector('[data-testid="login-mobile-layout"], [data-testid="login-desktop-layout"]');
  const orphanScrimsRemoved = removeOrphanLoginScrims(loginRoot);
  const audit = auditLoginPageOverlays();

  if (focusUsername) {
    window.requestAnimationFrame(() => {
      const usernameField = document.getElementById('login-username');
      usernameField?.focus?.({ preventScroll: false });
    });
  }

  emitAgentDebugLog({
    location: 'loginPagePresentation.js:resetLoginPagePresentation',
    message: 'login page presentation reset',
    hypothesisId,
    data: {
      logContext,
      orphanScrimsRemoved,
      ...audit,
    },
  });

  return {
    orphanScrimsRemoved,
    ...audit,
  };
}

export function scheduleLoginPresentationRecovery({
  focusUsername = false,
  logContext = 'scheduled-recovery',
} = {}) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const recover = (reason) => {
    resetLoginPagePresentation({
      focusUsername,
      logContext: `${logContext}:${reason}`,
      hypothesisId: 'H4',
    });
  };

  recover('immediate');
  window.requestAnimationFrame(() => recover('raf'));

  const onVisible = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    recover('visibility');
    window.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
  };

  window.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);

  return () => {
    window.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
  };
}
