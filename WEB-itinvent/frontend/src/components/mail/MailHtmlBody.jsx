import { useLayoutEffect, useRef } from 'react';
import { Box } from '@mui/material';
import {
  MAIL_HTML_SANDBOX_PERMISSIONS,
  buildMailSandboxSrcDoc,
  measureMailSandboxFrameHeight,
} from './mailHtmlSandboxDocument';
import { isMailHtmlSandboxEnabled } from './mailHtmlSandboxFlags';

const EMPTY_MAIL_HTML = '<p style="color:#999">Нет содержимого</p>';

function syncSandboxHeight(iframe) {
  const height = measureMailSandboxFrameHeight(iframe);
  if (!iframe || height <= 0) return;
  iframe.style.height = `${height}px`;
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
  const sandboxEnabled = isMailHtmlSandboxEnabled();
  const resolvedColor = color || (colorScheme === 'dark' ? '#f3f2f1' : '#242424');
  const resolvedLinkColor = linkColor || (colorScheme === 'dark' ? '#8cc8ff' : '#1976d2');

  useLayoutEffect(() => {
    if (!sandboxEnabled) return undefined;
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let clickHandler;

    const bind = () => {
      syncSandboxHeight(iframe);
      const doc = iframe.contentDocument;
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

    iframe.addEventListener('load', bind);
    bind();
    return () => {
      iframe.removeEventListener('load', bind);
      const doc = iframe.contentDocument;
      if (doc && clickHandler) {
        doc.removeEventListener('click', clickHandler);
      }
    };
  }, [sandboxEnabled, bodyHtml, onActivate]);

  if (!sandboxEnabled) {
    return (
      <Box
        className={className}
        sx={sx}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    );
  }

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
