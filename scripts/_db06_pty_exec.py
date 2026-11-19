"""Run a remote command under sudo on DB-06 via a real PTY (ConPTY).

Password travels only inside the PTY channel: never in argv, never on disk.
Usage: set SUDO_PASS and REMOTE_CMD env vars, run with the project python.
"""
from __future__ import annotations

import os
import sys
import time

from winpty import PtyProcess

PROMPT = "HUBIT_SUDO_PWD"
REMOTE = os.environ["REMOTE_CMD"]
PASSWORD = os.environ["SUDO_PASS"]

pty = PtyProcess.spawn(
    ["ssh", "-tt", "-o", "BatchMode=yes", "hubit-db06",
     f"sudo -p '{PROMPT}' bash -c {REMOTE!r}"],
    dimensions=(40, 200),
)

buf = ""
sent = False
deadline = time.time() + 600
out = []
while time.time() < deadline:
    try:
        if not pty.isalive():
            break
        chunk = pty.read(4096)
        if not chunk:
            time.sleep(0.1)
            continue
        buf += chunk
        if PROMPT in buf and not sent:
            pty.write(PASSWORD + "\n")
            sent = True
            buf = ""
    except EOFError:
        break
    except Exception:
        time.sleep(0.1)

# drain whatever remains
try:
    while pty.isalive():
        out.append(pty.read(4096))
except Exception:
    pass
try:
    pty.close()
except Exception:
    pass

text = buf + "".join(out)
# strip the echoed prompt line for readability; never print the password
print(text.replace(PASSWORD, "****"))
if not sent:
    print("\n[pty] ERROR: sudo prompt was never seen", file=sys.stderr)
    sys.exit(2)
