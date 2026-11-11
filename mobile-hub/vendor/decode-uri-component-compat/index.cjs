// query-string 7 expects a CommonJS function; the patched upstream decoder is ESM.
module.exports = require('decode-uri-component-safe').default;
