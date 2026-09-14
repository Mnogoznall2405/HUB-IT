set -euo pipefail
exec 2>&1
cd /
systemctl is-active hub-ai-worker hub-ai-gateway
systemctl is-enabled hub-ai-worker hub-ai-gateway
readlink /opt/hub-ai/current
df -h /var/lib/hub-ai-sandbox/workspaces
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman ps --format '{{.Names}} {{.Status}}'
/opt/hub-ai/venv/bin/python - <<'PY'
from pathlib import Path
import json,hashlib
root=Path('/opt/hub-ai/current')
manifest=json.loads((root/'release-manifest.json').read_text())
print('RELEASE_HASHES_MATCH',all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in manifest.items()))
from dotenv import dotenv_values
v=dotenv_values('/home/hub-ai-sandbox/gateway/gateway.env')
print('PROVIDER_GO',v.get('ROUTERAI_BASE_URL')=='https://opencode.ai/zen/go/v1')
print('MODEL',v.get('AI_SANDBOX_LLM_MODEL'))
PY
