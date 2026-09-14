set -euo pipefail
exec 2>&1
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/hub-ai-sandbox/worker.env')
pin=Path('/etc/hub-ai-sandbox/image.pin').read_text().strip()
p.write_text('\n'.join('AI_SANDBOX_IMAGE='+pin if x.startswith('AI_SANDBOX_IMAGE=') else x for x in p.read_text().splitlines())+'\n')
print(pin)
PY
systemctl restart hub-ai-worker
