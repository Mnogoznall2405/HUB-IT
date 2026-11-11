set -euo pipefail
exec 2>&1
cd /
cp -p /etc/hub-ai-sandbox/gateway-runtime.env /root/hub-ai-backup-20260913/gateway-runtime-before-libffi.env
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/hub-ai-sandbox/gateway-runtime.env')
pin=Path('/etc/hub-ai-sandbox/gateway.image.pin').read_text().strip()
p.write_text('\n'.join('HUB_AI_GATEWAY_IMAGE='+pin if x.startswith('HUB_AI_GATEWAY_IMAGE=') else x for x in p.read_text().splitlines())+'\n')
print(pin)
PY
systemctl restart hub-ai-gateway
systemctl is-active hub-ai-gateway hub-ai-worker
