"""Local helper: SSH as user, su to root, run a command. Reads secrets from .env."""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"


def env_get(key: str) -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not m:
        raise SystemExit(f"missing {key} in .env")
    return m.group(1)


def recv_all(chan: paramiko.Channel, wait: float = 0.4) -> str:
    time.sleep(wait)
    chunks: list[bytes] = []
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if chan.recv_ready():
            chunks.append(chan.recv(65535))
            deadline = time.time() + 0.4
        else:
            time.sleep(0.05)
    return b"".join(chunks).decode("utf-8", "replace")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()

    host = env_get("AI_SANDBOX_SSH_HOST")
    user = env_get("AI_SANDBOX_SSH_USER")
    user_pw = env_get("AI_SANDBOX_SSH_USER_PASSWORD")
    root_pw = env_get("AI_SANDBOX_SSH_PASSWORD")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        username=user,
        password=user_pw,
        timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    chan = client.invoke_shell(width=220, height=60)
    recv_all(chan, 0.6)
    chan.send("su - root\n")
    buf = ""
    end = time.time() + 10
    while time.time() < end:
        buf += recv_all(chan, 0.2)
        if "Password:" in buf or "password:" in buf:
            break
    chan.send(root_pw + "\n")
    buf2 = recv_all(chan, 1.0)
    if "Authentication failure" in buf2 or "su: " in buf2.lower():
        print("SU_FAIL")
        print(buf2.replace(root_pw, "***")[-500:])
        return 3
    marker = f"HUB_CMD_DONE_{int(time.time())}"
    # Prefer non-login shell command with explicit exit code marker.
    remote = (
        f"export DEBIAN_FRONTEND=noninteractive; "
        f"({args.command}); ec=$?; echo {marker}:$ec\n"
    )
    chan.send(remote)
    out = ""
    end = time.time() + args.timeout
    while time.time() < end:
        chunk = recv_all(chan, 0.3)
        if chunk:
            out += chunk
            if f"{marker}:" in out:
                break
        else:
            time.sleep(0.2)
    safe = out.replace(root_pw, "***").replace(user_pw, "***")
    print(safe)
    m = re.search(rf"{re.escape(marker)}:(\d+)", out)
    client.close()
    if not m:
        print("NO_EXIT_MARKER", file=sys.stderr)
        return 4
    return int(m.group(1))


if __name__ == "__main__":
    raise SystemExit(main())
