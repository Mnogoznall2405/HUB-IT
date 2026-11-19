import { useLayoutEffect, useRef } from 'react';
import { Box } from '@mui/material';
import {
  MAIL_HTML_SANDBOX_PERMISSIONS,
  buildMailSandboxSrcDoc,
  measureMailSandboxFrameHeight,
} from './mailHtmlSandboxDocument';

const EMPTY_MAIL_HTML = '<p style="color:#999">Нет содержимого</p>';

function syncSandboxHeight(iframe) {
  if (!iframe) return;
  const height = measureMailSandboxFrameHeight(iframe);
  if (height <= 0) return;
  const next = `${height}px`;
  // `!important` keeps the measured value authoritative: wrapper sx rules may
  // carry `height: auto !important` for embedded media, which would otherwise
  // pin the frame at the 150px default and re-introduce an inner scrollbar.
  if (iframe.style.getPropertyValue('height') !== next) {
    iframe.style.setProperty('height', next, 'important');
  }
}

export default function MailHtmlBody({
  html,
  sx,
  className = '',
  title = 'Содержимое письма',
  colorScheme = 'light',
  color,
  backgroundColor = 'transparent',
  fontFamily,
  fontSize,
  lineHeight,
  linkColor,
  collapseQuotes = false,
  onActivate,
} = {}) {
  const iframeRef = useRef(null);
  const bodyHtml = html || EMPTY_MAIL_HTML;
  const resolvedColor = color || (colorScheme === 'dark' ? '#f3f2f1' : '#242424');
  const resolvedLinkColor = linkColor || (colorScheme === 'dark' ? '#8cc8ff' : '#1976d2');

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let clickHandler;
    let resizeObserver = null;
    let frameObserver = null;
    let rafId = 0;
    const resyncTimers = [];

    const bind = () => {
      syncSandboxHeight(iframe);
      const doc = iframe.contentDocument;
      // Images/fonts can finish loading after `load` and grow the document:
      // keep the frame fitted instead of clipping or nesting a scrollbar.
      if (doc?.documentElement && typeof ResizeObserver === 'function') {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => syncSandboxHeight(iframe));
        resizeObserver.observe(doc.documentElement);
        if (doc.body && doc.body !== doc.documentElement) {
          resizeObserver.observe(doc.body);
        }
      }
      // Late layout passes (web fonts, async images, reflow after pane resize)
      // can escape the inner observers; re-measure on a short settle chain.
      rafId = requestAnimationFrame(() => syncSandboxHeight(iframe));
      resyncTimers.push(
        setTimeout(() => syncSandboxHeight(iframe), 200),
        setTimeout(() => syncSandboxHeight(iframe), 800),
      );
      if (!doc || typeof onActivate !== 'function') return;
      if (clickHandler) {
        doc.removeEventListener('click', clickHandler);
      }
      clickHandler = (event) => {
        if (event.target?.closest?.('a')) return;
        onActivate(event);
      };
      doc.addEventListener('click', clickHandler);
    };

    // The `load` event of a srcdoc iframe is unreliable in several engines
    // (WebKit may fire it before listeners attach or not at all), so binding
    // must not wait for it: retry until the inner document exists.
    let bindAttempts = 0;
    const tryBind = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) {
        if (bindAttempts < 40) {
          bindAttempts += 1;
          resyncTimers.push(setTimeout(tryBind, 100));
        }
        return;
      }
      bindAttempts = 40;
      bind();
    };

    iframe.addEventListener('load', tryBind);
    // Safety net: resync when the frame element itself resizes (pane/window),
    // even if the inner-document observer was lost on a srcdoc navigation.
    if (typeof ResizeObserver === 'function') {
      frameObserver = new ResizeObserver(() => syncSandboxHeight(iframe));
      frameObserver.observe(iframe);
    }
    tryBind();
    return () => {
      iframe.removeEventListener('load', bind);
      resizeObserver?.disconnect();
      frameObserver?.disconnect();
      cancelAnimationFrame(rafId);
      resyncTimers.forEach((timer) => clearTimeout(timer));
      const doc = iframe.contentDocument;
      if (doc && clickHandler) {
        doc.removeEventListener('click', clickHandler);
      }
    };
  }, [bodyHtml, onActivate]);

  return (
    <Box className={className} sx={{ ...sx, p: 0, overflow: 'hidden' }}>
      <Box
        component="iframe"
        ref={iframeRef}
        title={title}
        srcDoc={buildMailSandboxSrcDoc(bodyHtml, {
          color: resolvedColor,
          backgroundColor,
          fontFamily,
          fontSize,
          lineHeight,
          linkColor: resolvedLinkColor,
          collapseQuotes,
        })}
        sandbox={MAIL_HTML_SANDBOX_PERMISSIONS}
        referrerPolicy="no-referrer"
        data-testid="mail-html-sandbox"
        data-mail-html-sandbox="true"
        sx={{
          display: 'block',
          width: '100%',
          minHeight: 32,
          border: 0,
          background: 'transparent',
        }}
      />
    </Box>
  );
}
