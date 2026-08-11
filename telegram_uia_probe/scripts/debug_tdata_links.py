"""Explore whether tdata maps/binlog link cache keys to messages."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

from telegram_probe.media_cache import (
    _QtDataStreamReader,
    _decrypt_tdf_legacy,
    _read_tdf,
    decrypt_tdef,
    default_tdata_path,
    get_local_key,
)


def decrypt_tdf_file(path: Path, local_key: bytes) -> bytes:
    _ver, data = _read_tdf(path)
    # TDF$ payload is QByteArray(encrypted) for many files
    reader = _QtDataStreamReader(data)
    encrypted = reader.read_bytearray()
    if encrypted is None:
        # sometimes whole data is the encrypted blob
        return _decrypt_tdf_legacy(data, local_key)
    return _decrypt_tdf_legacy(encrypted, local_key)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    tdata = default_tdata_path()
    local_key = get_local_key(tdata)
    lines: list[str] = [f"tdata={tdata}", f"local_key_len={len(local_key)}"]

    # Known cache key for Отпечаток photo
    target_key = "571A1C260E10"
    target_sha_prefix = "2e1b1f532cf43f47"

    idx = json.loads((root / "media" / "index.json").read_text(encoding="utf-8"))
    keys = []
    for item in idx.get("items") or []:
        src = Path(item["source"])
        keys.append(src.name)
    lines.append(f"indexed_cache_keys={len(keys)}")
    lines.append(f"sample_keys={keys[:8]}")

    acc = next(p for p in tdata.iterdir() if p.is_dir() and re.fullmatch(r"[0-9A-F]{16}", p.name))
    lines.append(f"account_dir={acc.name}")

    # Decrypt maps and search for cache key bytes / ascii
    for name in ("maps", "configs"):
        path = acc / name
        if not path.is_file():
            continue
        try:
            plain = decrypt_tdf_file(path, local_key)
        except Exception as exc:  # noqa: BLE001
            lines.append(f"{name}: decrypt_fail {exc}")
            continue
        lines.append(f"{name}: decrypted_len={len(plain)}")
        # search ascii hex key
        if target_key.encode() in plain:
            lines.append(f"  FOUND ascii {target_key} in {name}")
        # search as binary uint64? key is 12 hex chars = 6 bytes
        try:
            key_bytes = bytes.fromhex(target_key)
            if key_bytes in plain:
                pos = plain.find(key_bytes)
                lines.append(f"  FOUND binary {target_key} at {pos} in {name}")
                lines.append(f"  context={plain[max(0,pos-16):pos+32].hex()}")
        except ValueError:
            pass
        try:
            text = plain.decode("utf-8", errors="ignore")
        except Exception:
            text = ""
        for needle in ("Отпечаток", "photo", "Photo", "message", "cache", "media"):
            if needle.lower() in text.lower() or needle.encode("utf-8") in plain:
                lines.append(f"  contains {needle!r}")

    # Try decrypting large account *s files and search for key
    big_files = sorted(
        [p for p in acc.iterdir() if p.is_file() and p.suffix == "" or p.name.endswith("s")],
        key=lambda p: p.stat().st_size,
        reverse=True,
    )[:8]
    for path in big_files:
        if path.name in {"maps", "configs"}:
            continue
        raw = path.read_bytes()[:4]
        try:
            if raw == b"TDF$":
                plain = decrypt_tdf_file(path, local_key)
            elif raw == b"TDEF":
                plain = decrypt_tdef(path, local_key)
            else:
                lines.append(f"{path.name}: unknown_magic={raw!r} size={path.stat().st_size}")
                continue
        except Exception as exc:  # noqa: BLE001
            lines.append(f"{path.name}: fail {exc} size={path.stat().st_size}")
            continue
        hit = False
        key_bytes = bytes.fromhex(target_key)
        if key_bytes in plain or target_key.encode() in plain:
            hit = True
            pos = plain.find(key_bytes)
            if pos < 0:
                pos = plain.find(target_key.encode())
            lines.append(
                f"{path.name}: HIT key size={path.stat().st_size} plain={len(plain)} pos={pos}"
            )
            lines.append(f"  ctx={plain[max(0,pos-24):pos+48].hex()}")
        else:
            lines.append(f"{path.name}: ok plain={len(plain)} no_key")

        # look for 720x1280 as little-endian ints
        if struct.pack("<II", 720, 1280) in plain:
            lines.append(f"  has uint32 720,1280 LE")
        if struct.pack(">II", 720, 1280) in plain:
            lines.append(f"  has uint32 720,1280 BE")

    # binlog in cache
    for binlog in [
        tdata / "user_data" / "cache" / "0" / "binlog",
        tdata / "user_data" / "media_cache" / "0" / "binlog",
    ]:
        if not binlog.is_file():
            continue
        try:
            data = binlog.read_bytes()
        except PermissionError as exc:
            lines.append(f"{binlog}: locked {exc}")
            continue
        lines.append(f"binlog {binlog} size={len(data)} head={data[:16].hex()}")
        key_bytes = bytes.fromhex(target_key)
        if key_bytes in data:
            pos = data.find(key_bytes)
            lines.append(f"  HIT key in binlog at {pos}")
            lines.append(f"  ctx={data[max(0,pos-32):pos+64].hex()}")
        # search all indexed keys count in binlog
        hits = sum(1 for k in keys if bytes.fromhex(k) in data if len(k) == 12)
        lines.append(f"  indexed_key_hits_in_binlog={hits}/{len(keys)}")

    # key_datas / settings — skip auth
    # Also check whether cache path hash relates to telegram file location
    lines.append("\n=== key naming ===")
    lines.append(
        "Cache filenames look like 48-bit hex keys (content location hash), "
        "not message ids. maps is small and usually stores key→file mapping for settings, "
        "not full message graph."
    )

    out = root / "_debug_tdata_links.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
