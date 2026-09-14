"""Run bootstrap on AI host via user SSH + sudo -S (non-interactive)."""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
SCRIPT = Path(__file__).with_name("_bootstrap_ai_host.sh")


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

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        username=user,
        password=upw,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
        banner_timeout=30,
    )
    sftp = client.open_sftp()
    remote = f"/home/{user}/_bootstrap_ai_host.sh"
    with sftp.file(remote, "wb") as fh:
        fh.write(raw)
    sftp.chmod(remote, 0o755)
    sftp.close()
    print("UPLOADED", len(raw), flush=True)

    # sudo uses the *user* password; user is in sudo group.
    cmd = f'sudo -S -p "" bash {remote}'
    print("START", cmd, flush=True)
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=None)
    stdin.write(upw + "\n")
    stdin.flush()

    # Merge streams: with get_pty, stderr often comes on stdout.
    channel = stdout.channel
    channel.settimeout(5.0)
    out_chunks: list[str] = []
    started = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(65535).decode("utf-8", "replace")
            safe = chunk.replace(upw, "***")
            safe_print(safe)
            out_chunks.append(safe)
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(65535).decode("utf-8", "replace")
            safe = chunk.replace(upw, "***")
            safe_print(safe)
            out_chunks.append(safe)
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.time() - started > 2400:
            print("\nTIMEOUT", flush=True)
            channel.close()
            client.close()
            return 5
        time.sleep(0.2)

    code = channel.recv_exit_status()
    print("\nFINAL_EXIT", code, flush=True)
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
