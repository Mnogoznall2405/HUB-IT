set -euo pipefail
exec 2>&1
cd /
test -f /home/hub-ai-sandbox/gateway/gateway.env
cp -p /home/hub-ai-sandbox/gateway/gateway.env /root/hub-ai-backup-20260913/gateway-before-deepseek.env
python3 - <<'PY'
from pathlib import Path
p=Path('/home/hub-ai-sandbox/gateway/gateway.env')
source=Path('/home/user/hub-ai-rollout/provider-update.env')
updates=dict(line.split('=',1) for line in source.read_text().splitlines() if '=' in line)
assert set(updates)=={'ROUTERAI_API_KEY','AI_SANDBOX_LLM_MODEL','ROUTERAI_BASE_URL'}
lines=[line for line in p.read_text().splitlines() if line.split('=',1)[0] not in updates]
p.write_text('\n'.join(lines+[k+'='+v for k,v in updates.items()])+'\n')
source.unlink()
print('Gateway provider configuration updated')
PY
systemctl restart hub-ai-gateway.service
systemctl is-active hub-ai-gateway.service hub-ai-worker.service
