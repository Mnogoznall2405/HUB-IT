set -u
exec 2>&1
cd /
journalctl -u hub-ai-worker -u hub-ai-gateway --since '3 minutes ago' --no-pager | tail -25
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman logs --tail=15 hub-opencode-32d2547bbc2af474-9c5667ac2fb6cfac
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman port hub-opencode-32d2547bbc2af474-9c5667ac2fb6cfac
ps -eo pid,ppid,comm,wchan:24 | awk '$2==52453 || $1==52453'
ps -o pid,ppid,args --ppid 52453
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman inspect --format '{{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' hub-opencode-32d2547bbc2af474-9c5667ac2fb6cfac
