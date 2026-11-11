"""Verify AI VM sandbox host readiness via user+sudo."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import paramiko

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def env_get(key: str) -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"missing {key}")
    return m.group(1)


REMOTE = r'''
set -e
cd /
echo "=== host ==="
hostname
. /etc/os-release
echo "os=$PRETTY_NAME"
echo "=== accounts ==="
id hub-ai-sandbox
echo "=== files ==="
ls -ld /var/lib/hub-ai-sandbox/workspaces /etc/hub-ai-sandbox/seccomp-opencode.json /usr/local/libexec/hub-ai-sandbox-quota /run/user/10001/hub-ai-sandbox /etc/hub-ai-sandbox/image.pin 2>&1 || true
echo -n "image_pin="; cat /etc/hub-ai-sandbox/image.pin 2>/dev/null || echo MISSING
echo "=== quota smoke ==="
smoke=/var/lib/hub-ai-sandbox/workspaces/check-ready
rm -rf "$smoke"
/usr/local/sbin/hub-ai-sandbox-quota-ensure "$smoke" 1073741824
rm -rf "$smoke"
echo "=== rootless podman ==="
sudo -u hub-ai-sandbox -H XDG_RUNTIME_DIR=/run/user/10001 bash -lc '
  cd /home/hub-ai-sandbox
  echo -n "security="; podman info --format "{{.Host.Security.Rootless}} {{.Host.NetworkBackend}}"
  echo -n "internal="; podman network inspect --format "{{.Internal}} {{.DNSEnabled}}" hub-ai-internal
  echo -n "egress="; podman network inspect --format "{{.Internal}} {{.Name}}" hub-ai-gateway-egress
  echo -n "image="; podman image exists localhost/hub/opencode-sandbox:build && echo PRESENT || echo ABSENT
  podman images --format "{{.Repository}}:{{.Tag}} {{.ID}} {{.Digest}}" | grep -F opencode-sandbox || true
  PIN=$(cat /etc/hub-ai-sandbox/image.pin)
  echo "run_version=$(podman run --rm --network=none --entrypoint=opencode "$PIN" --version 2>/dev/null || podman run --rm --network=none --entrypoint=opencode localhost/hub/opencode-sandbox:build --version)"
'
echo "=== host tools ==="
command -v opencode; opencode --version
command -v podman; test -x /opt/hub-ai-tools/bin/python && echo VENV_OK
hub-ai-python -c "import pymupdf,pypdf,pdfplumber; print(\"PDF_OK\")"
echo "=== done ==="
'''


def main() -> int:
    host = env_get("AI_SANDBOX_SSH_HOST")
    user = env_get("AI_SANDBOX_SSH_USER")
    upw = env_get("AI_SANDBOX_SSH_USER_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=upw, timeout=30, allow_agent=False, look_for_keys=False)
    # Write remote script to avoid quoting hell
    sftp = client.open_sftp()
    script = REMOTE.replace("\r\n", "\n")
    with sftp.file(f"/home/{user}/_check_ready.sh", "w") as fh:
        fh.write(script)
    sftp.chmod(f"/home/{user}/_check_ready.sh", 0o755)
    sftp.close()
    cmd = f'sudo -S -p "" bash /home/{user}/_check_ready.sh'
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    stdin.write(upw + "\n")
    stdin.flush()
    out = stdout.read().decode("utf-8", "replace").replace(upw, "***")
    err = stderr.read().decode("utf-8", "replace").replace(upw, "***")
    code = stdout.channel.recv_exit_status()
    print(out)
    if err.strip():
        print(err, file=sys.stderr)
    print("EXIT", code)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
