set -u
exec 2>&1
pid=$(systemctl show -p MainPID --value hub-ai-worker)
ss -tnp | grep "pid=$pid" || true
ps -o pid,ppid,args --ppid "$pid"
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman ps --filter label=hub.session=32d2547bbc2af474 --format '{{.Names}} {{.Ports}}'
journalctl -u hub-ai-worker --since '1 minute ago' --no-pager | tail -8
