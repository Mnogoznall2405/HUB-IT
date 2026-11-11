"""Search decrypted account blobs for captions / cache key forms."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

from telegram_probe.media_cache import (
    _QtDataStreamReader,
    _decrypt_tdf_legacy,
    _read_tdf,
    default_tdata_path,
    get_local_key,
)


def decrypt_tdf_file(path: Path, local_key: bytes) -> bytes:
    _ver, data = _read_tdf(path)
    reader = _QtDataStreamReader(data)
    encrypted = reader.read_bytearray()
    if encrypted is None:
        return _decrypt_tdf_legacy(data, local_key)
    return _decrypt_tdf_legacy(encrypted, local_key)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    tdata = default_tdata_path()
    local_key = get_local_key(tdata)
    acc = next(p for p in tdata.iterdir() if p.is_dir() and re.fullmatch(r"[0-9A-F]{16}", p.name))

    idx = json.loads((root / "media" / "index.json").read_text(encoding="utf-8"))
    target = next(i for i in idx["items"] if i["id"].startswith("2e1b1f532cf43f47"))
    key_hex = Path(target["source"]).name  # 571A1C260E10
    key6 = bytes.fromhex(key_hex)
    # also try as big-endian uint64 padded
    key8_be = key6.rjust(8, b"\x00")
    key8_le = key6.ljust(8, b"\x00")

    lines = [f"target_key={key_hex}", f"target_src={target['source']}"]

    needles = {
        "key6": key6,
        "key8_be": key8_be,
        "key8_le": key8_le,
        "key_ascii": key_hex.encode(),
        "otpechatok": "Отпечаток".encode("utf-8"),
        "otpechatok_utf16le": "Отпечаток".encode("utf-16le"),
    }

    files = [p for p in acc.iterdir() if p.is_file() and p.read_bytes()[:4] == b"TDF$"]
    for path in sorted(files, key=lambda p: p.stat().st_size, reverse=True):
        try:
            plain = decrypt_tdf_file(path, local_key)
        except Exception as exc:  # noqa: BLE001
            lines.append(f"{path.name}: FAIL {exc}")
            continue
        hits = []
        for name, needle in needles.items():
            pos = plain.find(needle)
            if pos >= 0:
                hits.append((name, pos))
        if hits:
            lines.append(f"{path.name}: size={path.stat().st_size} plain={len(plain)}")
            for name, pos in hits:
                ctx = plain[max(0, pos - 32) : pos + len(needles[name]) + 48]
                lines.append(f"  HIT {name} @{pos} ctx_hex={ctx.hex()}")
                # try show nearby utf-8
                nearby = plain[max(0, pos - 64) : pos + 128]
                nearby_txt = nearby.decode("utf-8", errors="replace")
                lines.append(f"  nearby_utf8={nearby_txt!r}")
        else:
            lines.append(f"{path.name}: plain={len(plain)} no hits")

        # Extract utf-8 / utf-16 strings that look like captions near 'Фото'
        if path.stat().st_size > 100_000:
            for m in re.finditer("Отпечат".encode("utf-8"), plain):
                lines.append(f"  partial Отпечат @{m.start()}")

    # Parse configs for anything useful
    try:
        configs = decrypt_tdf_file(acc / "configs", local_key)
        lines.append(f"\nconfigs strings:")
        for m in re.finditer(rb"[\x20-\x7e]{5,}", configs):
            s = m.group().decode("ascii", errors="ignore")
            if any(x in s.lower() for x in ("cache", "path", "download", "media", "photo")):
                lines.append(f"  {s}")
    except Exception as exc:  # noqa: BLE001
        lines.append(f"configs fail {exc}")

    # Explain Storage::Cache::Key: two uint64. Filename may be truncated.
    lines.append("\n=== interpretation ===")
    lines.append(
        "tdesktop cache file names are derived from Storage::Cache::Key "
        "(photo/document location), NOT from message id. "
        "Message→PhotoId mapping lives in in-memory / synced history; "
        "full chat DB is not a simple sqlite in this tdata layout."
    )
    lines.append(
        "Practical precise link options: (1) visual ahash from UIA bubble, "
        "(2) parse maps/lskLocations if present for key↔path only, "
        "(3) use MTP auth key to fetch messages from API (session export — out of scope)."
    )

    out = root / "_debug_tdata_deep.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
