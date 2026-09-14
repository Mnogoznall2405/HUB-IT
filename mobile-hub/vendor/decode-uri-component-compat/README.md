# Compatibility adapter

`query-string@7`, used by Expo Router 57, calls `require('decode-uri-component')`
as a function. The upstream security fix in version 0.5.0 exports an ESM default.
This adapter retains the existing callable API and delegates all decoding to the
unmodified, pinned upstream package (installed under an npm alias).

Security advisory: https://github.com/advisories/GHSA-vcc3-ghjq-m6fr

Remove this adapter and its override when Expo Router adopts a query parser
that directly supports the patched decoder. Do not override the old decoder
with 0.5.0 directly: the CommonJS caller would receive a module object.
