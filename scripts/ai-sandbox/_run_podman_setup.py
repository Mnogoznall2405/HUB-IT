"""Upload Podman host setup + seccomp and run via user sudo."""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
SCRIPT = Path(__file__).with_name("_setup_podman_host.sh")
SECCOMP = Path(__file__).with_name("seccomp-opencode.json")


def env_get(key: str) -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"missing {key}")
    return m.group(1)


def safe_print(text: str) -> None:
    try:
        print(text, end="", flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(text.encode(sys.stdout.encoding or "utf-8", errors="replace"))
        sys.stdout.buffer.flush()


def main() -> int:
    host = env_get("AI_SANDBOX_SSH_HOST")
    user = env_get("AI_SANDBOX_SSH_USER")
    upw = env_get("AI_SANDBOX_SSH_USER_PASSWORD")

    raw = SCRIPT.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    SCRIPT.write_bytes(raw)
    sec = SECCOMP.read_bytes()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=upw, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    with sftp.file(f"/home/{user}/_setup_podman_host.sh", "wb") as fh:
        fh.write(raw)
    sftp.chmod(f"/home/{user}/_setup_podman_host.sh", 0o755)
    with sftp.file(f"/home/{user}/seccomp-opencode.json", "wb") as fh:
        fh.write(sec)
    sftp.chmod(f"/home/{user}/seccomp-opencode.json", 0o644)
    sftp.close()
    print("UPLOADED", flush=True)

    cmd = f'sudo -S -p "" bash /home/{user}/_setup_podman_host.sh'
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    stdin.write(upw + "\n")
    stdin.flush()
    channel = stdout.channel
    channel.settimeout(5.0)
    started = time.time()
    while True:
        if channel.recv_ready():
            safe_print(channel.recv(65535).decode("utf-8", "replace").replace(upw, "***"))
        if channel.recv_stderr_ready():
            safe_print(channel.recv_stderr(65535).decode("utf-8", "replace").replace(upw, "***"))
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.time() - started > 900:
            print("\nTIMEOUT", flush=True)
            return 5
        time.sleep(0.2)
    code = channel.recv_exit_status()
    print("\nFINAL_EXIT", code, flush=True)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
