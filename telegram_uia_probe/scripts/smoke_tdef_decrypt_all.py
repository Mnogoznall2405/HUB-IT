"""Decrypt all media_cache TDEF files (smoke). No session export."""

from __future__ import annotations

import sys
from pathlib import Path

from smoke_tdef_decrypt import (
    decrypt_tdef,
    default_tdata,
    get_local_key,
    sniff_type,
)


def reassemble_streaming(data: bytes) -> bytes | None:
    if len(data) < 4:
        return None
    count = int.from_bytes(data[:4], "little")
    if count == 0 or count > 1000:
        return None
    pos = 4
    parts: list[tuple[int, int, bytes]] = []
    try:
        for _ in range(count):
            if pos + 8 > len(data):
                return None
            offset = int.from_bytes(data[pos : pos + 4], "little")
            size = int.from_bytes(data[pos + 4 : pos + 8], "little")
            pos += 8
            if size == 0 or pos + size > len(data):
                return None
            parts.append((offset, size, data[pos : pos + size]))
            pos += size
    except Exception:
        return None
    if not parts:
        return None
    max_end = max(offset + size for offset, size, _ in parts)
    out = bytearray(max_end)
    for offset, _size, part in parts:
        out[offset : offset + len(part)] = part
    return bytes(out)


def main() -> int:
    tdata = default_tdata()
    local_key, version = get_local_key(tdata)
    print(f"local_key_ok len={len(local_key)} version={version}")
    media = tdata / "user_data" / "media_cache"
    out = Path(__file__).resolve().parents[1] / "output" / "media_smoke"
    out.mkdir(parents=True, exist_ok=True)

    files = sorted(
        (p for p in media.rglob("*") if p.is_file()),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    ok = fail = photos = 0
    for path in files:
        try:
            plain = decrypt_tdef(path, local_key)
            assembled = reassemble_streaming(plain)
            final = assembled if assembled is not None else plain
            kind = sniff_type(final)
            ext = kind.split("(")[0]
            if ext.startswith("streaming") or ext.startswith("unknown"):
                ext = "bin"
            dest = out / f"{path.name}.{ext}"
            dest.write_bytes(final)
            streaming = assembled is not None
            print(
                f"OK {path.name} enc={path.stat().st_size} "
                f"final={len(final)} type={kind} streaming={streaming} -> {dest.name}"
            )
            ok += 1
            if kind in {"jpeg", "png", "webp", "gif"}:
                photos += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {path}: {exc}", file=sys.stderr)
            fail += 1

    print(f"summary ok={ok} fail={fail} photos={photos} out={out}")
    return 0 if ok and not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
