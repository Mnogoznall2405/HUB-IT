"""Count indexed media by dimensions."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "output"
    idx = json.loads((root / "media" / "index.json").read_text(encoding="utf-8"))
    c = Counter()
    for item in idx.get("items") or []:
        w, h = item.get("width"), item.get("height")
        kind = item.get("kind")
        c[f"{kind}:{w}x{h}"] += 1
    lines = [f"{k}: {v}" for k, v in c.most_common(40)]
    out = root / "_debug_media_dims.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
