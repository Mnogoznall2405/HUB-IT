"""Show decrypted TDEF prefix before media bytes for 720x1280 items."""

from __future__ import annotations

import json
from pathlib import Path

from telegram_probe.media_cache import (
    decrypt_tdef,
    default_tdata_path,
    get_local_key,
)


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    idx = json.loads((root / "media" / "index.json").read_text(encoding="utf-8"))
    key = get_local_key(default_tdata_path())
    lines: list[str] = []
    want = {
        "2e1b1f532cf43f47.jpeg",
        "c028ffc037138e88.jpeg",
        "9f74bb0cffb8cd05.jpeg",
        "0eec7696ab625f71.jpeg",
    }
    for item in idx.get("items") or []:
        name = Path(item["rel_path"]).name
        if name not in want and not (
            item.get("width") == 720 and item.get("height") == 1280
        ):
            continue
        src = Path(item["source"])
        if not src.is_file():
            continue
        try:
            plain = decrypt_tdef(src, key)
        except Exception as exc:  # noqa: BLE001
            lines.append(f"{name}: decrypt fail {exc}")
            continue
        jpeg_at = plain.find(b"\xff\xd8\xff")
        prefix = plain[: min(64, len(plain) if jpeg_at < 0 else jpeg_at)]
        lines.append(
            f"{name} src={src.name} len={len(plain)} jpeg_at={jpeg_at} "
            f"prefix_hex={prefix.hex()} prefix_ascii={prefix!r}"
        )
        if name in want or True:
            if len(lines) > 25:
                break
    out = root / "_debug_tdef_prefix.txt"
    # only targeted + first few 720
    out.write_text("\n".join(lines[:30]), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
