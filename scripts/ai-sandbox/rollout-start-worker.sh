set -euo pipefail
exec 2>&1
cd /
systemctl enable --now hub-ai-worker.service
sleep 4
systemctl is-active hub-ai-worker.service
journalctl -u hub-ai-worker.service -n 12 --no-pager
cat /etc/hub-ai-sandbox/image.pin
