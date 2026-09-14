"""Quick remote status via user->su."""
from __future__ import annotations

import re
import time
from pathlib import Path

import paramiko

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def env_get(key: str) -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"missing {key}")
    return m.group(1)


def recv(chan, wait=0.3):
    time.sleep(wait)
    data = b""
    end = time.time() + 1.2
    while time.time() < end:
        if chan.recv_ready():
            data += chan.recv(65535)
            end = time.time() + 0.4
        else:
            time.sleep(0.05)
    return data.decode("utf-8", "replace")


def main() -> int:
    host = env_get("AI_SANDBOX_SSH_HOST")
    user = env_get("AI_SANDBOX_SSH_USER")
    upw = env_get("AI_SANDBOX_SSH_USER_PASSWORD")
    rpw = env_get("AI_SANDBOX_SSH_PASSWORD")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=upw, timeout=20, allow_agent=False, look_for_keys=False)
    chan = client.invoke_shell(width=200, height=50)
    recv(chan, 0.5)
    chan.send("su - root\n")
    buf = ""
    end = time.time() + 10
    while time.time() < end:
        buf += recv(chan, 0.2)
        if "Password:" in buf:
            break
    chan.send(rpw + "\n")
    recv(chan, 0.8)
    marker = "HUB_STATUS_DONE"
    cmd = (
        "ps -ef | grep -E 'apt|dpkg|bootstrap' | grep -v grep; "
        "command -v opencode || echo NO_OPENCODE; "
        "command -v podman || echo NO_PODMAN; "
        "test -x /opt/hub-ai-tools/bin/python && echo VENV_OK || echo NO_VENV; "
        "python3 --version; "
        f"echo {marker}\n"
    )
    chan.send(cmd)
    out = ""
    end = time.time() + 60
    while time.time() < end:
        chunk = recv(chan, 0.3)
        if chunk:
            out += chunk
            if marker in out:
                break
    print(out.replace(rpw, "***").replace(upw, "***")[-2500:])
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
