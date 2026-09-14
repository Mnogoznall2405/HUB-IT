set -euo pipefail
exec 2>&1
systemctl disable --now hub-ai-worker.service
systemctl is-active hub-ai-gateway.service
bash -n /home/user/hub-ai-rollout/allow-postgres-ai-host.sh
echo 'Worker stopped pending PostgreSQL host access; gateway remains active.'
