"""Inspect metadata for specific media files and nearby cache entries."""

from __future__ import annotations

import json
import struct
from datetime import datetime
from pathlib import Path

from PIL import Image, ExifTags


def dump_image(path: Path) -> dict:
    info: dict = {"path": str(path), "size_bytes": path.stat().st_size}
    try:
        with Image.open(path) as im:
            info["format"] = im.format
            info["size"] = im.size
            info["mode"] = im.mode
            info["info_keys"] = sorted(str(k) for k in im.info.keys())
            exif = {}
            raw = im.getexif()
            if raw:
                for k, v in raw.items():
                    name = ExifTags.TAGS.get(k, str(k))
                    if isinstance(v, bytes):
                        v = v[:40].hex()
                    else:
                        v = str(v)[:200]
                    exif[name] = v
            info["exif"] = exif
    except Exception as exc:  # noqa: BLE001
        info["error"] = str(exc)
    return info


def peek_tdef_plain_header(tdata_item_source: str, local_key_getter) -> dict:
    return {}


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    target = "2e1b1f532cf43f47.jpeg"
    idx = json.loads((root / "media" / "index.json").read_text(encoding="utf-8"))
    items = idx.get("items") or []
    by_name = {Path(i["rel_path"]).name: i for i in items}

    lines: list[str] = []
    item = by_name.get(target)
    lines.append(f"=== target {target} ===")
    lines.append(json.dumps(item, ensure_ascii=False, indent=2))
    img_path = root / "media" / target
    lines.append("PIL/EXIF:")
    lines.append(json.dumps(dump_image(img_path), ensure_ascii=False, indent=2))

    # All 720x1280 with mtimes
    lines.append("\n=== all 720x1280 ===")
    for i in sorted(
        [x for x in items if x.get("width") == 720 and x.get("height") == 1280],
        key=lambda x: x.get("source_mtime") or 0,
    ):
        mtime = datetime.fromtimestamp(i["source_mtime"]).isoformat(timespec="seconds")
        lines.append(
            f"{Path(i['rel_path']).name} mtime={mtime} "
            f"src={i.get('source')} sha={i.get('sha256')[:16]}"
        )

    # Current Kamchatka binding for Отпечаток
    st = json.loads((root / "state.json").read_text(encoding="utf-8"))
    chat = next(c for c in st["chats"] if "амчат" in c["chat_name"].lower())
    msgs = [
        json.loads(line)
        for line in (root / "chats" / f"{chat['chat_id']}.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    lines.append("\n=== kamchatka media rows ===")
    for i, m in enumerate(msgs):
        if not m.get("media_path") and "отограф" not in (
            (m.get("media") or "") + (m.get("text") or "")
        ).lower():
            continue
        lines.append(
            f"[{i}] text={(m.get('text') or '')[:60]!r} path={m.get('media_path')} "
            f"match={m.get('media_match')}"
        )

    out = root / "_debug_media_metadata.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
