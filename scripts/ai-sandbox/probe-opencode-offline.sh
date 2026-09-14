set -euo pipefail
exec 2>&1
cd /
run() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 "$@"; }
image=$(cat /etc/hub-ai-sandbox/image.pin)
run podman run -d --rm --name hub-ai-offline-probe --network=hub-ai-internal --publish=127.0.0.1::4096 --userns=keep-id:uid=10001,gid=10001 --read-only --tmpfs=/tmp:rw,size=268435456 --env=OPENCODE_DISABLE_DEFAULT_PLUGINS=1 --env=OPENCODE_DISABLE_MODELS_FETCH=1 --env=OPENCODE_DISABLE_LSP_DOWNLOAD=1 --env=OPENCODE_DISABLE_PROJECT_CONFIG=1 --env=OPENCODE_PURE=1 --env=HOME=/tmp/home --env=XDG_DATA_HOME=/tmp/data --env=XDG_STATE_HOME=/tmp/state --env=XDG_CACHE_HOME=/tmp/cache "$image" serve --hostname 0.0.0.0 --port 4096 >/dev/null
trap 'run podman stop -t 1 hub-ai-offline-probe >/dev/null' EXIT
sleep 3
port=$(run podman port hub-ai-offline-probe 4096/tcp)
curl --max-time 10 -s -o /tmp/hub-ai-offline-probe-response -w 'SESSION_HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' "http://$port/session"
run podman logs --tail=8 hub-ai-offline-probe
