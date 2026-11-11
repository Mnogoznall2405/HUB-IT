"""Scan decrypted TDEF / cache for image magic bytes."""

from __future__ import annotations

from pathlib import Path

from smoke_tdef_decrypt import decrypt_tdef, default_tdata, get_local_key, sniff_type

MAGICS = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"RIFF", "riff"),
    (b"GIF8", "gif"),
)


def find_magic(data: bytes) -> list[tuple[int, str]]:
    hits: list[tuple[int, str]] = []
    for magic, name in MAGICS:
        start = 0
        while True:
            idx = data.find(magic, start)
            if idx < 0:
                break
            if name == "riff" and data[idx + 8 : idx + 12] != b"WEBP":
                start = idx + 1
                continue
            hits.append((idx, "webp" if name == "riff" else name))
            start = idx + 1
    return hits


def main() -> None:
    tdata = default_tdata()
    local_key, _ = get_local_key(tdata)
    out = Path(__file__).resolve().parents[1] / "output" / "media_smoke"
    out.mkdir(parents=True, exist_ok=True)

    roots = [
        tdata / "user_data" / "media_cache",
        tdata / "user_data" / "cache",
    ]
    image_count = 0
    checked = 0
    for root in roots:
        files = [p for p in root.rglob("*") if p.is_file() and p.name not in {"version", "binlog"}]
        print(f"=== {root.name}: {len(files)} files ===")
        for path in sorted(files, key=lambda p: p.stat().st_size, reverse=True):
            try:
                plain = decrypt_tdef(path, local_key)
            except Exception as exc:  # noqa: BLE001
                print(f"FAIL {root.name}/{path.relative_to(root)}: {exc}")
                continue
            checked += 1
            hits = find_magic(plain)
            kind = sniff_type(plain)
            if hits or kind in {"jpeg", "png", "webp", "gif"}:
                image_count += 1
                offset, itype = hits[0] if hits else (0, kind)
                chunk = plain[offset:]
                dest = out / f"img_{root.name}_{path.name}.{itype}"
                dest.write_bytes(chunk)
                print(
                    f"IMAGE {root.name}/{path.relative_to(root)} "
                    f"enc={path.stat().st_size} dec={len(plain)} "
                    f"hit={itype}@{offset} sniff={kind} -> {dest.name}"
                )
            elif path.stat().st_size > 200_000:
                print(
                    f"big  {root.name}/{path.relative_to(root)} "
                    f"enc={path.stat().st_size} dec={len(plain)} sniff={kind}"
                )

    print(f"checked={checked} images_found={image_count} out={out}")


if __name__ == "__main__":
    main()
