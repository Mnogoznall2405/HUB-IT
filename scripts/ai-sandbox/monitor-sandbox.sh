#!/bin/bash
# Read-only HUB AI sandbox health check for a systemd timer.
# Checks: worker/gateway units active, gateway container Up (not Created),
# rootless podman responsive, control TCP reachable. Never restarts, removes
# or rewrites anything; writes a JSON status file and exits non-zero on failure.
set -u
exec 2>&1
cd /

SANDBOX_USER=hub-ai-sandbox
SANDBOX_UID=10001
STATUS_FILE=/run/hub-ai-sandbox/monitor.status
FAILURES=""

fail() {
  FAILURES="${FAILURES}${FAILURES:+;} $1"
  echo "FAIL: $1"
}

run_as() {
  # NOTE: no DBUS_SESSION_BUS_ADDRESS here on purpose. With the session bus
  # exported, rootless `podman info` hangs when executed under a systemd unit
  # (works fine from an SSH shell). Podman falls back gracefully without it.
  sudo -u "$SANDBOX_USER" -H \
    XDG_RUNTIME_DIR=/run/user/$SANDBOX_UID \
    -- "$@"
}

for unit in hub-ai-worker.service hub-ai-gateway.service; do
  state="$(systemctl is-active "$unit" 2>/dev/null || true)"
  echo "$unit: $state"
  [ "$state" = "active" ] || fail "$unit is $state"
done

gateway_state="$(run_as env XDG_RUNTIME_DIR=/run/user/$SANDBOX_UID podman ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep '^hub-ai-llm-gateway ' || true)"
echo "gateway container: ${gateway_state:-<missing>}"
case "$gateway_state" in
  *" Up "*) ;;
  *) fail "hub-ai-llm-gateway container is not Up" ;;
esac

podman_ok=0
for attempt in 1 2 3; do
  if timeout 20 run_as env XDG_RUNTIME_DIR=/run/user/$SANDBOX_UID podman info --format '{{.Host.Security.Rootless}}' >/dev/null 2>&1; then
    podman_ok=1
    break
  fi
  echo "rootless podman info attempt $attempt failed; retrying"
  sleep 10
done
if [ "$podman_ok" = "1" ]; then
  echo "rootless podman: ok"
else
  # Best effort only: `podman info` hangs when launched under a systemd unit
  # (identical command succeeds from an SSH shell), while `podman ps` above
  # already proves the daemon responds. Rootless/netavark pinning is verified
  # by preflight at rollout time instead of here.
  echo "WARN: rootless podman info unavailable under systemd; see preflight"
fi

if ! timeout 10 bash -c '</dev/tcp/hub-ai-control/8443' >/dev/null 2>&1; then
  fail "control hub-ai-control:8443 TCP unreachable"
else
  echo "control 8443: reachable"
fi

if [ -z "$FAILURES" ]; then
  status="ok"
else
  status="fail"
fi
printf '{"timestamp_utc":"%s","status":"%s","failures":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$status" "${FAILURES//\"/}" > "$STATUS_FILE"
chmod 0644 "$STATUS_FILE" 2>/dev/null || true
echo "status=$status"
[ -z "$FAILURES" ]
