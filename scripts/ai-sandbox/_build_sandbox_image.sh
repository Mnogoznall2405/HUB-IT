#!/bin/bash
# Build HUB OpenCode sandbox image on the AI VM (local digest pin, no feature flag).
set -euo pipefail
cd /
SANDBOX_USER=hub-ai-sandbox
SANDBOX_UID=10001
BUILD_DIR=/home/hub-ai-sandbox/hub-opencode-build
IMAGE_NAME=localhost/hub/opencode-sandbox
IMAGE_TAG=build

install -d -m 0755 -o "${SANDBOX_UID}" -g "${SANDBOX_UID}" "${BUILD_DIR}"
# Context files uploaded next to this script by the runner into /home/user/ai-sandbox-build
SRC=/home/user/ai-sandbox-build
cp -f "${SRC}/Containerfile" "${SRC}/requirements.lock" "${SRC}/opencode.json" "${BUILD_DIR}/"
chown -R "${SANDBOX_UID}:${SANDBOX_UID}" "${BUILD_DIR}"

run_as() {
  sudo -u "${SANDBOX_USER}" -H \
    XDG_RUNTIME_DIR="/run/user/${SANDBOX_UID}" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${SANDBOX_UID}/bus" \
    -- "$@"
}

echo "=== pull base + build ==="
run_as bash -lc "cd ${BUILD_DIR}; podman build --file Containerfile --tag ${IMAGE_NAME}:${IMAGE_TAG} ."

echo "=== resolve digest ==="
# Prefer manifest digest; fall back to image Id.
DIGEST="$(run_as bash -lc "podman image inspect --format '{{.Digest}}' ${IMAGE_NAME}:${IMAGE_TAG}" | tr -d '\r')"
if [ -z "${DIGEST}" ] || [ "${DIGEST}" = "<none>" ]; then
  echo "Manifest digest unavailable; refusing an image-ID pin" >&2; exit 20
fi
case "${DIGEST}" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) echo "bad digest: ${DIGEST}" >&2; exit 20 ;;
esac

PINNED="${IMAGE_NAME}@${DIGEST}"
# Also tag by digest-friendly local name for stable pulls
run_as bash -lc "podman tag ${IMAGE_NAME}:${IMAGE_TAG} ${PINNED}" || true

echo "AI_SANDBOX_IMAGE=${PINNED}"
run_as bash -lc "podman image inspect --format 'Id={{.Id}} Size={{.Size}} OcVer=check' ${IMAGE_NAME}:${IMAGE_TAG}"
run_as bash -lc "podman run --rm --network=none --entrypoint=opencode ${PINNED} --version" || \
  run_as bash -lc "podman run --rm --network=none --entrypoint=opencode ${IMAGE_NAME}:${IMAGE_TAG} --version"

# Persist pin for the host
install -d -m 0755 /etc/hub-ai-sandbox
printf '%s\n' "${PINNED}" > /etc/hub-ai-sandbox/image.pin
chmod 0644 /etc/hub-ai-sandbox/image.pin
echo "DONE"
