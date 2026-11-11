"""Force-correct Kamchatka «Отпечаток» → 2e1b1f532cf43f47.jpeg (user confirmed)."""

from __future__ import annotations

import json
from pathlib import Path


TARGET = "media/2e1b1f532cf43f47.jpeg"


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    st = json.loads((root / "state.json").read_text(encoding="utf-8"))
    chat = next(c for c in st["chats"] if "амчат" in c["chat_name"].lower())
    path = root / "chats" / f"{chat['chat_id']}.jsonl"
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    donor_idx = None
    ot_idx = None
    for i, m in enumerate(rows):
        text = (m.get("text") or "") + " " + (m.get("media") or "")
        if "Отпечаток" in text:
            ot_idx = i
        if m.get("media_path") == TARGET:
            donor_idx = i

    if ot_idx is None:
        raise SystemExit("Отпечаток message not found")

    prev = rows[ot_idx].get("media_path")
    # Free TARGET from whoever holds it.
    if donor_idx is not None and donor_idx != ot_idx:
        rows[donor_idx]["media_path"] = prev
        rows[donor_idx]["media_kind"] = "jpeg"
        rows[donor_idx]["media_match"] = "swap:heuristic"
        if not prev:
            rows[donor_idx].pop("media_path", None)
            rows[donor_idx].pop("media_kind", None)
            rows[donor_idx].pop("media_match", None)

    rows[ot_idx]["media_path"] = TARGET
    rows[ot_idx]["media_kind"] = "jpeg"
    rows[ot_idx]["media_match"] = "manual:user"

    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"fixed [{ot_idx}] Отпечаток -> {TARGET} (was {prev})")


if __name__ == "__main__":
    main()
