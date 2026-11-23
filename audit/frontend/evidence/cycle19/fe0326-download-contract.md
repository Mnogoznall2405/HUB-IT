# FE-0326 — download-contract follow-up (cycle 19 sign-off)

## What the matrix actually did

`fe0326-matrix.cjs` used the legacy private endpoint:

```
GET /api/v1/my-files/{id}/download  -> 410 Gone
```

The endpoint is intentionally disabled in `WEB-itinvent/backend/api/v1/my_files.py:1063-1073`:
«Legacy blob/XHR path disabled: force clients to use one-time download-grant after deploy.»

The public download was compared with the **original** SHA. For optimized images this is
the wrong comparison: the app stores optimized media as WebP (`storage_mode=optimized_media`,
`download_file_name=*.webp`, `download_mime_type=image/webp`) and the download endpoints
serve the stored representation, not the original bytes.

## Actual contracts

| Purpose | Endpoint | Result |
|---|---|---|
| Private legacy download | `GET /api/v1/my-files/{id}/download` | **410 Gone by design** (disabled path) |
| Private download (current) | `POST /api/v1/my-files/{id}/download-grant` → `{download_path}`; `GET /api/v1/my-files/download-grant/{token}` | one-time grant, stored payload |
| Public download | `GET /api/v1/my-files/public/{token}/download` | stored payload |
| Preview | `GET /api/v1/my-files/{id}/preview/content` (and public variant) | preview artifact (WebP/PNG) |

Frontend uses the grant flow: `api/myFiles.js:614-639` (`createDownloadGrant` →
`buildDownloadGrantUrl` → native download); the legacy path is not used.

## Stored representation in this matrix

| File | Original | Storage | Public download | Equals preview? | Equals original? |
|---|---|---|---|---|---|
| small | 117 B PNG | optimized_media, `.webp` | 80 B `image/webp`, sha `3f6f...` | yes (preview 80 B `3f6f...`) | no (expected) |
| medium | 4,485 B PNG | stored, `.png` | 4,485 B `image/png`, sha `f440...` | yes | yes (no optimization) |
| large | 5,769,402 B PNG | optimized_media, `.webp` | 1,437,182 B `image/webp`, sha `bedb...` | yes (preview `bedb...`) | no (expected) |

The private grant flow was not exercised by the matrix; the 410 is a test-methodology gap,
not an app defect. Optimized WebP download is allowed by the storage contract; the original
SHA is preserved as `original_sha256`, but the original bytes may not be retained when
`storage_mode=optimized_media`.

## Conclusion

- The matrix's `privateDownload=410` and `matchesOriginal=false` for small/large are
  **expected contract/test-methodology artifacts**, not defects.
- Correct test: use the private grant flow; compare public/private downloads to the
  **stored** representation (preview SHA) and check `download_mime_type`/
  `download_file_name`; use original SHA only when `storage_mode=stored`.
- FE-0326 remains **Rejected**: valid PNG previews are correct. No new app defect.
