set -euo pipefail
exec 2>&1
stage=/home/user/hub-ai-rollout
test -d /root/hub-ai-backup-20260913
cp -n /etc/systemd/system/hub-ai-gateway.service /root/hub-ai-backup-20260913/hub-ai-gateway.service
install -o root -g root -m 644 "$stage/containers-service.conf" /etc/hub-ai-sandbox/containers-service.conf
install -o root -g root -m 644 "$stage/hub-ai-gateway.service" /etc/systemd/system/hub-ai-gateway.service
install -o root -g root -m 644 "$stage/hub-ai-worker.service" /etc/systemd/system/hub-ai-worker.service
systemctl daemon-reload
systemctl restart hub-ai-gateway.service
sleep 4
systemctl is-active hub-ai-gateway.service
journalctl -u hub-ai-gateway.service -n 8 --no-pager
