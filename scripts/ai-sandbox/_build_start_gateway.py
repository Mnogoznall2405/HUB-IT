"""Build + start HUB AI LLM gateway on TMN-SRV-AI-01 (feature flag stays off)."""
from __future__ import annotations

import io
import re
import secrets
import sys
import tarfile
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"

ALLOWLIST = [
    "WEB-itinvent/backend/__init__.py",
    "WEB-itinvent/backend/ai_sandbox_gateway_main.py",
    "WEB-itinvent/backend/config.py",
    "WEB-itinvent/backend/appdb/__init__.py",
    "WEB-itinvent/backend/appdb/db.py",
    "WEB-itinvent/backend/appdb/models.py",
    "WEB-itinvent/backend/services/__init__.py",
    "WEB-itinvent/backend/services/sql_observability.py",
    "WEB-itinvent/backend/ai_sandbox/__init__.py",
    "WEB-itinvent/backend/ai_sandbox/config.py",
    "WEB-itinvent/backend/ai_sandbox/contracts.py",
    "WEB-itinvent/backend/ai_sandbox/policy.py",
    "WEB-itinvent/backend/ai_sandbox/models.py",
    "WEB-itinvent/backend/ai_sandbox/gateway.py",
    "shared/__init__.py",
    "shared/llm/__init__.py",
    "shared/llm/client.py",
    "shared/llm/env.py",
    "shared/llm/errors.py",
    "shared/llm/models.py",
    "shared/llm/openai_gateway.py",
    "scripts/ai-sandbox/GatewayContainerfile",
    "scripts/ai-sandbox/gateway-requirements.lock",
]


def env_map() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def env_set(key: str, value: str) -> None:
    text = ENV_PATH.read_text(encoding="utf-8")
    if re.search(rf"^{re.escape(key)}=.*$", text, re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
    ENV_PATH.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")


def make_context_tar() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in ALLOWLIST:
            path = ROOT / rel
            if not path.is_file():
                raise SystemExit(f"missing {rel}")
            tar.add(path, arcname=rel)
    return buf.getvalue()


def safe_print(text: str) -> None:
    try:
        print(text, end="", flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()


def build_gateway_env(env: dict[str, str], *, model: str) -> str:
    """Build only trusted gateway settings, never the OpenCode process env."""
    values = {
        "APP_DATABASE_URL": env["APP_DATABASE_URL"],
        "APP_ENV": "production",
        "AI_SANDBOX_ENABLED": "1",
        "AI_SANDBOX_LLM_MODEL": model,
        "AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS": env.get("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS", "4000"),
        "ROUTERAI_API_KEY": env["ROUTERAI_API_KEY"],
        "ROUTERAI_BASE_URL": env.get("ROUTERAI_BASE_URL", "").strip() or "https://routerai.ru/api/v1",
        "ROUTERAI_MODEL": model,
        "PYTHONUNBUFFERED": "1",
    }
    if any(any(char in value for char in "\r\n\x00") for value in values.values()):
        raise ValueError("Gateway settings must contain single-line values")
    return "".join(f"{key}={value}\n" for key, value in values.items())


def main() -> int:
    env = env_map()
    host = env["AI_SANDBOX_SSH_HOST"]
    user = env["AI_SANDBOX_SSH_USER"]
    upw = env["AI_SANDBOX_SSH_USER_PASSWORD"]

    # Ensure secrets exist locally (never print values).
    transfer = env.get("AI_SANDBOX_TRANSFER_SERVICE_TOKEN", "").strip()
    if len(transfer) < 32:
        transfer = secrets.token_urlsafe(48)
        env_set("AI_SANDBOX_TRANSFER_SERVICE_TOKEN", transfer)
        print("generated_transfer_token=yes", flush=True)
    llm_model = env.get("AI_SANDBOX_LLM_MODEL", "").strip() or env.get("ROUTERAI_MODEL", "").strip()
    if not llm_model:
        raise SystemExit("AI_SANDBOX_LLM_MODEL / ROUTERAI_MODEL missing")
    env_set("AI_SANDBOX_LLM_MODEL", llm_model)
    print(f"llm_model_set={llm_model}", flush=True)

    app_db = env.get("APP_DATABASE_URL", "").strip()
    if not app_db:
        raise SystemExit("APP_DATABASE_URL missing")
    router_key = env.get("ROUTERAI_API_KEY", "").strip()
    router_base = env.get("ROUTERAI_BASE_URL", "").strip() or "https://routerai.ru/api/v1"
    if not router_key:
        raise SystemExit("ROUTERAI_API_KEY missing")

    tar_bytes = make_context_tar()
    print(f"context_bytes={len(tar_bytes)}", flush=True)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=upw, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    remote_tar = f"/home/{user}/gateway-context.tgz"
    with sftp.file(remote_tar, "wb") as fh:
        fh.write(tar_bytes)

    # Gateway env file content for hub-ai-sandbox (mode 0600 later).
    gateway_env = build_gateway_env(env, model=llm_model)
    with sftp.file(f"/home/{user}/gateway.env.stage", "w") as fh:
        fh.write(gateway_env)
    sftp.chmod(f"/home/{user}/gateway.env.stage", 0o600)

    remote_sh = f"/home/{user}/_build_start_gateway.sh"
    script = r'''#!/bin/bash
set -euo pipefail
cd /
SANDBOX_USER=hub-ai-sandbox
SANDBOX_UID=10001
BUILD=/home/hub-ai-sandbox/gateway-build
IMAGE=localhost/hub/ai-llm-gateway
TAG=build
ENV_FILE=/home/hub-ai-sandbox/hub-ai-gateway.env

rm -rf "$BUILD"
install -d -m 0750 -o "$SANDBOX_UID" -g "$SANDBOX_UID" "$BUILD"
tar -xzf /home/user/gateway-context.tgz -C "$BUILD"
chown -R "$SANDBOX_UID:$SANDBOX_UID" "$BUILD"

install -d -m 0700 -o "$SANDBOX_UID" -g "$SANDBOX_UID" /home/hub-ai-sandbox
install -m 0600 -o "$SANDBOX_UID" -g "$SANDBOX_UID" /home/user/gateway.env.stage "$ENV_FILE"
rm -f /home/user/gateway.env.stage
# stage file may remain owned by user; wipe
shred -u /home/user/gateway.env.stage 2>/dev/null || rm -f /home/user/gateway.env.stage

run_as() {
  sudo -u "$SANDBOX_USER" -H \
    XDG_RUNTIME_DIR=/run/user/$SANDBOX_UID \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$SANDBOX_UID/bus \
    -- "$@"
}

echo "=== build gateway ==="
run_as bash -lc "cd $BUILD; podman build --file scripts/ai-sandbox/GatewayContainerfile --tag ${IMAGE}:${TAG} ."
DIGEST=$(run_as bash -lc "podman image inspect --format '{{.Digest}}' ${IMAGE}:${TAG}" | tr -d '\r')
if [ -z "$DIGEST" ] || [ "$DIGEST" = "<none>" ]; then
  echo "Manifest digest unavailable; refusing an image-ID pin" >&2; exit 20
fi
case "$DIGEST" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) echo "bad digest $DIGEST" >&2; exit 20 ;;
esac
PINNED="${IMAGE}@${DIGEST}"
printf '%s\n' "$PINNED" > /etc/hub-ai-sandbox/gateway.image.pin
chmod 0644 /etc/hub-ai-sandbox/gateway.image.pin
echo "HUB_AI_GATEWAY_IMAGE=$PINNED"

echo "=== start gateway container ==="
run_as bash -lc "podman rm -f hub-ai-llm-gateway >/dev/null 2>&1 || true"
run_as bash -lc "podman run --detach --replace \
  --name hub-ai-llm-gateway \
  --user 10001:10001 --userns=keep-id:uid=10001,gid=10001 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=128 --cpus=1 --memory=1073741824 --memory-swap=1073741824 \
  --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --network=hub-ai-internal:alias=hub-ai-llm-gateway \
  --network=hub-ai-gateway-egress \
  --env-file $ENV_FILE \
  $PINNED"

sleep 2
echo "=== health from internal network ==="
run_as bash -lc "podman run --rm --network=hub-ai-internal --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --entrypoint=python3 localhost/hub/opencode-sandbox:build \
  -c 'import urllib.request; print(urllib.request.urlopen(\"http://hub-ai-llm-gateway:8080/health\", timeout=5).read().decode())'"
test -z "$(run_as bash -lc 'podman port hub-ai-llm-gateway' || true)"
echo "DONE"
'''
    raw = script.replace("\r\n", "\n").encode("utf-8")
    with sftp.file(remote_sh, "wb") as fh:
        fh.write(raw)
    sftp.chmod(remote_sh, 0o755)
    sftp.close()

    cmd = f'sudo -S -p "" bash {remote_sh}'
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    stdin.write(upw + "\n")
    stdin.flush()
    channel = stdout.channel
    channel.settimeout(5.0)
    out = ""
    started = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(65535).decode("utf-8", "replace")
            # redact secrets if echoed
            for secret in (upw, router_key, transfer, app_db):
                if secret:
                    chunk = chunk.replace(secret, "***")
            safe_print(chunk)
            out += chunk
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(65535).decode("utf-8", "replace")
            for secret in (upw, router_key, transfer, app_db):
                if secret:
                    chunk = chunk.replace(secret, "***")
            safe_print(chunk)
            out += chunk
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.time() - started > 1800:
            print("\nTIMEOUT", flush=True)
            return 5
        time.sleep(0.2)
    code = channel.recv_exit_status()
    print("\nFINAL_EXIT", code, flush=True)
    m = re.search(r"^HUB_AI_GATEWAY_IMAGE=(.+)$", out, re.M)
    if code == 0 and m:
        env_set("HUB_AI_GATEWAY_IMAGE", m.group(1).strip())
        print("ENV_PINNED_GATEWAY", m.group(1).strip(), flush=True)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
