set -euo pipefail
exec 2>&1
cd /
run() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 "$@"; }
image=$(cat /etc/hub-ai-sandbox/image.pin)
run podman run -d --rm --name hub-ai-port-probe --network=hub-ai-internal --publish=127.0.0.1::4096 --entrypoint=python3 "$image" -m http.server 4096 >/dev/null
trap 'run podman stop -t 1 hub-ai-port-probe >/dev/null' EXIT
run podman inspect --format '{{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' hub-ai-port-probe
run podman port hub-ai-port-probe
port=$(run podman port hub-ai-port-probe 4096/tcp)
sleep 1
curl --max-time 5 -s -o /dev/null -w 'LOOPBACK_HTTP %{http_code}\n' "http://$port/"
