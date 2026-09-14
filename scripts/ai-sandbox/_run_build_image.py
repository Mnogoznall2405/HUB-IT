"""Upload sandbox build context and build image on AI VM."""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
HERE = Path(__file__).resolve().parent
FILES = ("Containerfile", "requirements.lock", "opencode.json")
BUILD_SH = HERE / "_build_sandbox_image.sh"


def env_get(key: str) -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"missing {key}")
    return m.group(1)


def env_set(key: str, value: str) -> None:
    text = ENV_PATH.read_text(encoding="utf-8")
    if re.search(rf"^{re.escape(key)}=.*$", text, re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
    ENV_PATH.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")


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

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=upw, timeout=30, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    remote_dir = f"/home/{user}/ai-sandbox-build"
    try:
        sftp.mkdir(remote_dir)
    except OSError:
        pass
    for name in FILES:
        data = (HERE / name).read_bytes()
        with sftp.file(f"{remote_dir}/{name}", "wb") as fh:
            fh.write(data)
    raw = BUILD_SH.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    BUILD_SH.write_bytes(raw)
    with sftp.file(f"/home/{user}/_build_sandbox_image.sh", "wb") as fh:
        fh.write(raw)
    sftp.chmod(f"/home/{user}/_build_sandbox_image.sh", 0o755)
    sftp.close()
    print("UPLOADED", flush=True)

    cmd = f'sudo -S -p "" bash /home/{user}/_build_sandbox_image.sh'
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    stdin.write(upw + "\n")
    stdin.flush()
    channel = stdout.channel
    channel.settimeout(5.0)
    out = ""
    started = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(65535).decode("utf-8", "replace").replace(upw, "***")
            safe_print(chunk)
            out += chunk
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(65535).decode("utf-8", "replace").replace(upw, "***")
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
    client.close()

    m = re.search(r"^AI_SANDBOX_IMAGE=(.+)$", out, re.M)
    if code == 0 and m:
        pinned = m.group(1).strip()
        env_set("AI_SANDBOX_IMAGE", pinned)
        print("ENV_PINNED", pinned, flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
