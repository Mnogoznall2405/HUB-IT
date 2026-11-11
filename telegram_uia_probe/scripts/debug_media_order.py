"""Dump media message order for debugging."""

from __future__ import annotations

import json
from pathlib import Path

from telegram_probe.media_cache import message_wants_media, parse_media_dims


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    st = json.loads((root / "state.json").read_text(encoding="utf-8"))
    lines: list[str] = []
    for c in st.get("chats") or []:
        chat_id = c["chat_id"]
        name = c["chat_name"]
        path = root / "chats" / f"{chat_id}.jsonl"
        msgs = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        lines.append(f"=== {name} ({chat_id}) total={len(msgs)} ===")
        media_n = 0
        for i, m in enumerate(msgs):
            wants = message_wants_media({**m, "media_path": ""})
            if not wants and not m.get("media_path"):
                continue
            media_n += 1
            label, w, h = parse_media_dims(
                " ".join(str(m.get(k) or "") for k in ("media", "text"))
            )
            text = (m.get("text") or "")[:80]
            lines.append(
                f"[{i:04d}] time={m.get('time')!r} dir={m.get('direction')} "
                f"label={label} dims={w}x{h} path={m.get('media_path')} "
                f"match={m.get('media_match')} text={text!r}"
            )
        lines.append(f"media_rows={media_n} with_path={sum(1 for m in msgs if m.get('media_path'))}")
        lines.append("")

    out = root / "_debug_media_order.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
