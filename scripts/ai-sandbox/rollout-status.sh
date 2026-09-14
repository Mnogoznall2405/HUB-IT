set -u
exec 2>&1
cd /
journalctl -u hub-ai-gateway.service -n 8 --no-pager
journalctl -u hub-ai-worker.service -n 12 --no-pager
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman ps -a --format '{{.Names}} {{.Status}}'
