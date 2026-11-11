#!/bin/bash
# Prepare TMN-SRV-AI-01 for HUB OpenCode sandbox (step 1: host/Podman).
# Does NOT enable AI_SANDBOX_ENABLED or touch HUB production.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

SANDBOX_USER=hub-ai-sandbox
SANDBOX_UID=10001
SANDBOX_GID=10001
WORKSPACE_ROOT=/var/lib/hub-ai-sandbox/workspaces
ETC_DIR=/etc/hub-ai-sandbox
LIBEXEC=/usr/local/libexec/hub-ai-sandbox-quota
SECCOMP_SRC=/home/user/seccomp-opencode.json
QUOTA_BYTES=$((1024 * 1024 * 1024))

echo "=== create service account ${SANDBOX_USER} (${SANDBOX_UID}) ==="
if getent group "${SANDBOX_GID}" >/dev/null 2>&1; then
  existing_g="$(getent group "${SANDBOX_GID}" | cut -d: -f1)"
  if [ "${existing_g}" != "${SANDBOX_USER}" ]; then
    echo "GID ${SANDBOX_GID} already used by ${existing_g}" >&2
    exit 10
  fi
else
  groupadd --gid "${SANDBOX_GID}" "${SANDBOX_USER}"
fi

if id -u "${SANDBOX_USER}" >/dev/null 2>&1; then
  cur_uid="$(id -u "${SANDBOX_USER}")"
  if [ "${cur_uid}" != "${SANDBOX_UID}" ]; then
    echo "user ${SANDBOX_USER} exists with uid ${cur_uid}, expected ${SANDBOX_UID}" >&2
    exit 11
  fi
else
  if getent passwd "${SANDBOX_UID}" >/dev/null 2>&1; then
    echo "UID ${SANDBOX_UID} already used" >&2
    exit 12
  fi
  useradd --uid "${SANDBOX_UID}" --gid "${SANDBOX_GID}" \
    --create-home --home-dir "/home/${SANDBOX_USER}" \
    --shell /bin/bash "${SANDBOX_USER}"
fi

# Rootless Podman subordinate IDs
grep -q "^${SANDBOX_USER}:" /etc/subuid || echo "${SANDBOX_USER}:100000:65536" >> /etc/subuid
grep -q "^${SANDBOX_USER}:" /etc/subgid || echo "${SANDBOX_USER}:100000:65536" >> /etc/subgid

echo "=== linger + runtime dir ==="
loginctl enable-linger "${SANDBOX_USER}"
# Ensure user manager is up for /run/user/10001
machinectl shell "${SANDBOX_USER}@" /bin/true 2>/dev/null || true
sleep 1
install -d -m 0700 -o "${SANDBOX_UID}" -g "${SANDBOX_GID}" "/run/user/${SANDBOX_UID}"
install -d -m 0700 -o "${SANDBOX_UID}" -g "${SANDBOX_GID}" "/run/user/${SANDBOX_UID}/hub-ai-sandbox"

echo "=== directories + seccomp ==="
install -d -m 0755 "${ETC_DIR}"
install -d -m 0700 -o "${SANDBOX_UID}" -g "${SANDBOX_GID}" /var/lib/hub-ai-sandbox
install -d -m 0700 -o "${SANDBOX_UID}" -g "${SANDBOX_GID}" "${WORKSPACE_ROOT}"
if [ -f "${SECCOMP_SRC}" ]; then
  install -m 0444 -o root -g root "${SECCOMP_SRC}" "${ETC_DIR}/seccomp-opencode.json"
else
  echo "missing ${SECCOMP_SRC}" >&2
  exit 13
fi

# Project quota must be provisioned by the reviewed dedicated-volume rollout.
# Never install the old marker-based verifier during generic host bootstrap.
echo "Quota provisioning required: install quota_root.py and quota-wrapper.sh"

run_as_sandbox() {
  sudo -u "${SANDBOX_USER}" -H \
    XDG_RUNTIME_DIR="/run/user/${SANDBOX_UID}" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${SANDBOX_UID}/bus" \
    -- "$@"
}

# Ensure home is usable and owned correctly
chown -R "${SANDBOX_UID}:${SANDBOX_GID}" "/home/${SANDBOX_USER}"
chmod 755 "/home/${SANDBOX_USER}"

# Start user dbus if needed
run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; systemctl --user is-active dbus >/dev/null 2>&1 || systemctl --user start dbus || true" || true

echo -n "podman_version="
run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman --version"
echo -n "podman_security="
run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman info --format '{{.Host.Security.Rootless}} {{.Host.NetworkBackend}}'" || true

if ! run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network exists hub-ai-internal"; then
  run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network create --internal hub-ai-internal"
fi
if ! run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network exists hub-ai-gateway-egress"; then
  run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network create hub-ai-gateway-egress"
fi

echo -n "internal_net="
run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network inspect --format '{{.Internal}} {{.DNSEnabled}}' hub-ai-internal"
echo -n "egress_net="
run_as_sandbox bash -lc "cd /home/${SANDBOX_USER}; podman network inspect --format '{{.Internal}} {{.Name}}' hub-ai-gateway-egress"

echo "=== summary ==="
id "${SANDBOX_USER}"
ls -ld "${WORKSPACE_ROOT}" "${ETC_DIR}/seccomp-opencode.json" "${LIBEXEC}" "/run/user/${SANDBOX_UID}/hub-ai-sandbox"
echo "FEATURE_FLAG=still_off"
echo "DONE"
