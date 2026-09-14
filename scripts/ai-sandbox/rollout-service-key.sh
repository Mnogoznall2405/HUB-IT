set -euo pipefail
exec 2>&1
python3 - <<'PY'
from pathlib import Path
import secrets
for name in ('/home/hub-ai-sandbox/gateway/gateway.env', '/etc/hub-ai-sandbox/worker.env'):
    path=Path(name)
    value=path.read_text()
    if 'AUTH_COOKIE_SECURE=' not in value:
        with path.open('a') as stream:
            stream.write('\nAUTH_COOKIE_SECURE=true\n')
    if not any(line.startswith('JWT_SECRET_KEY=') for line in value.splitlines()):
        with path.open('a') as stream:
            stream.write('\nJWT_SECRET_KEY='+secrets.token_urlsafe(48)+'\n')
print('ISOLATED_SERVICE_KEYS_CONFIGURED')
PY
systemctl restart hub-ai-gateway.service
sleep 4
systemctl is-active hub-ai-gateway.service
