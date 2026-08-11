"""Inspect Kamchatka media pairing vs cache mtimes."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    st = json.loads((root / "state.json").read_text(encoding="utf-8"))
    chat = next(c for c in st["chats"] if "амчат" in c["chat_name"].lower())
    msgs = [
        json.loads(line)
        for line in (root / "chats" / f"{chat['chat_id']}.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    idx = {
        i["rel_path"]: i
        for i in json.loads((root / "media" / "index.json").read_text(encoding="utf-8")).get(
            "items", []
        )
    }
    lines = [f"chat={chat['chat_name']}"]
    for i, m in enumerate(msgs):
        if not m.get("media_path") and "отограф" not in (
            (m.get("media") or "") + (m.get("text") or "")
        ).lower():
            continue
        rel = m.get("media_path")
        meta = idx.get(rel or "", {})
        mtime = meta.get("source_mtime")
        mtime_s = (
            datetime.fromtimestamp(mtime).isoformat(timespec="seconds") if mtime else None
        )
        lines.append(
            f"[{i:04d}] msg_time={m.get('time')} recorded={m.get('recorded_at')} "
            f"caption={(m.get('text') or '')[:50]!r} "
            f"uia_dims={m.get('media')} -> {rel} "
            f"file={meta.get('width')}x{meta.get('height')} "
            f"src_mtime={mtime_s} src={Path(meta.get('source') or '').name}"
        )
    out = root / "_debug_kamchatka.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
