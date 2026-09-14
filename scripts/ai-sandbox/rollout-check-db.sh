set -euo pipefail
exec 2>&1
/opt/hub-ai/venv/bin/python - <<'PY'
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
values = dotenv_values('/etc/hub-ai-sandbox/worker.env')
engine = create_engine(values['APP_DATABASE_URL'], connect_args={'connect_timeout': 8, 'sslmode': 'require'})
try:
    with engine.connect() as connection:
        print('LINUX_DATABASE_SELECT_1', connection.execute(text('SELECT 1')).scalar())
except Exception as exc:
    print('LINUX_DATABASE_CHECK', type(exc).__name__, 'HBA_REJECT' if 'pg_hba.conf rejects' in str(exc) else 'CONNECTION_FAILED')
finally:
    engine.dispose()
PY
systemctl is-active hub-ai-gateway.service
systemctl is-active hub-ai-worker.service || true
