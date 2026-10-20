"""Включает звонки чата в боевом .env: CALLS_ENABLED, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.

Ключ и секрет берутся из scripts/livekit/livekit.yaml (gitignored) и нигде не печатаются.
Перед правкой копия .env кладётся в deploy_backups/ (каталог в .gitignore).
Откат: скопировать бэкап обратно в .env и перезапустить backend/chat.

Запуск из корня репозитория:  python scripts/livekit/set-calls-env.py
"""
import pathlib
import re
import shutil
import time

root = pathlib.Path(__file__).resolve().parents[2]
env_path = root / ".env"
yaml_path = root / "scripts" / "livekit" / "livekit.yaml"
public_url = "wss://hubit.zsgp.ru/livekit"

backup_dir = root / "deploy_backups"
backup_dir.mkdir(exist_ok=True)
backup = backup_dir / ("env-before-calls-" + time.strftime("%Y%m%d-%H%M%S") + ".bak")
shutil.copy2(env_path, backup)
print("backup created:", backup.name)

y = yaml_path.read_text(encoding="utf-8")
m = re.search(r"^keys:\s*\n\s+([A-Za-z0-9_-]+):\s*(\S+)\s*$", y, re.M)
assert m, "keys block not found in livekit.yaml"
key, secret = m.group(1), m.group(2)
assert len(secret) >= 32, "secret too short"

raw = env_path.read_bytes().decode("utf-8")
nl = "\r\n" if "\r\n" in raw else "\n"
lines = raw.split(nl)
wanted = {
    "CALLS_ENABLED": "true",
    "LIVEKIT_URL": public_url,
    "LIVEKIT_API_KEY": key,
    "LIVEKIT_API_SECRET": secret,
}
done = set()
for i, line in enumerate(lines):
    for k, v in wanted.items():
        if re.match(r"^\s*" + k + r"\s*=", line):
            lines[i] = k + "=" + v
            done.add(k)
if lines and lines[-1] == "":
    lines.pop()
for k, v in wanted.items():
    if k not in done:
        lines.append(k + "=" + v)
env_path.write_bytes((nl.join(lines) + nl).encode("utf-8"))
print("updated:", sorted(done), "appended:", sorted(set(wanted) - done), "(values not printed)")
