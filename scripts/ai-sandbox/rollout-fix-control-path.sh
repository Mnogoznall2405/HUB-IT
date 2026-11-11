set -euo pipefail
exec 2>&1
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/hub-ai-sandbox/worker.env')
lines=p.read_text().splitlines()
p.write_text('\n'.join('AI_SANDBOX_CONTENT_TRANSFER_URL=https://hub-ai-control:8443/api/v1/chat/internal/ai/sandbox' if x.startswith('AI_SANDBOX_CONTENT_TRANSFER_URL=') else x for x in lines)+'\n')
PY
systemctl restart hub-ai-worker.service
sleep 3
systemctl is-active hub-ai-worker.service
