-- V3.1 plan-check seed for PostgreSQL: mirrors the SQLite stand distribution.
-- owner_user_id=3 (e2e_admin analog), 171 folders (one 10000-file, one 5000,
-- one 1000, 500/100/10 buckets), 16 804 files total.
BEGIN;

INSERT INTO app.my_file_folders (id, owner_user_id, name, parent_id, created_at, updated_at, is_favorite)
SELECT
  md5('v31f' || g)::varchar,
  3,
  'v31-folder-' || g,
  NULL,
  now() - interval '30 days',
  now() - interval '30 days',
  false
FROM generate_series(1, 171) AS g;

-- Helper: pick a folder id by bucket.
CREATE TEMP TABLE v31_buckets (bucket int, files int, folder_id varchar);
INSERT INTO v31_buckets (bucket, files, folder_id)
VALUES
  (1, 10000, md5('v31f1')::varchar),
  (2, 5000,  md5('v31f2')::varchar),
  (3, 1000,  md5('v31f3')::varchar),
  (4, 500,   md5('v31f4')::varchar),
  (5, 100,   md5('v31f5')::varchar),
  (6, 10,    md5('v31f6')::varchar),
  (7, 194,   NULL);  -- spread over the rest

INSERT INTO app.my_files (
  id, owner_user_id, owner_username, folder_id,
  original_file_name, download_file_name, mime_type, download_mime_type,
  original_size_bytes, stored_size_bytes, retention_days,
  status, storage_mode, spool_path, error_text,
  created_at, updated_at, expires_at,
  security_scan_status, security_scan_engine, is_favorite, office_session_key
)
SELECT
  md5('v31file' || gs)::varchar,
  3,
  'e2e_admin',
  CASE
    WHEN gs <= 10000 THEN md5('v31f1')::varchar
    WHEN gs <= 15000 THEN md5('v31f2')::varchar
    WHEN gs <= 16000 THEN md5('v31f3')::varchar
    WHEN gs <= 16500 THEN md5('v31f4')::varchar
    WHEN gs <= 16600 THEN md5('v31f5')::varchar
    WHEN gs <= 16610 THEN md5('v31f6')::varchar
    ELSE NULL
  END,
  'v31-file-' || gs || '.txt',
  'v31-file-' || gs || '.txt',
  'text/plain',
  'text/plain',
  1024 + (gs % 4096),
  1024 + (gs % 4096),
  365,
  'ready',
  'blob',
  '/spool/v31/' || gs,
  '',
  now() - (gs || ' seconds')::interval,
  now() - (gs || ' seconds')::interval,
  now() + interval '365 days',
  'clean',
  'none',
  false,
  ''
FROM generate_series(1, 16804) AS gs;

ANALYZE app.my_files;
ANALYZE app.my_file_folders;
COMMIT;
