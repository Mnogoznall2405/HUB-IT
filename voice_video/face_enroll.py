"""Эталоны лиц сотрудников: применить подпись из галереи, посмотреть, удалить, стереть превью.

    python face_enroll.py apply OUT_DIR assign.json    # подписанные кластеры -> data/face_roster.json (только векторы)
    python face_enroll.py list                          # кто в базе и сколько кадров
    python face_enroll.py remove "Фамилия Имя Отчество" # убрать человека (увольнение, ошибка)
    python face_enroll.py purge OUT_DIR                 # удалить превью лиц и векторы кластеризации
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import face_roster  # noqa: E402

ROSTER_PATH = HERE / "data" / "face_roster.json"
MIN_CENTER_SIM = 0.40   # лицо дальше от центра кластера — вероятно чужое: в эталон не берём


def apply_assignment(roster, faces_data: Dict[str, Any], vectors, assign: Dict[str, Dict[str, Any]],
                     min_center_sim: float = MIN_CENTER_SIM) -> Dict[str, int]:
    """Переносит подписанные кластеры в эталоны. Возвращает {имя: сколько лиц взято}."""
    import numpy as np

    added: Dict[str, int] = {}
    for cluster in faces_data["clusters"]:
        choice = assign.get(str(cluster["id"])) or {}
        name = str(choice.get("name") or "").strip()
        if not name or choice.get("delete"):
            continue
        excluded = {int(i) for i in choice.get("excluded") or []}
        ids = [i for i in cluster["faces"] if i not in excluded]
        if not ids:
            continue
        mat = np.asarray([vectors[i] for i in ids], dtype=np.float64)
        mat = mat / np.linalg.norm(mat, axis=1, keepdims=True)
        center = mat.mean(axis=0)
        center /= np.linalg.norm(center) or 1.0
        kept = [v for v in mat if float(v @ center) >= min_center_sim]
        if not kept:
            continue
        roster.add(name, np.mean(kept, axis=0), weight=len(kept))
        added[name] = added.get(name, 0) + len(kept)
    return added


def main(argv: Optional[Sequence[str]] = None) -> int:
    import numpy as np

    parser = argparse.ArgumentParser(description="Эталоны лиц")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("apply", "purge", "list", "remove"):
        p = sub.add_parser(name)
        if name == "apply":
            p.add_argument("out_dir")
            p.add_argument("assign")
            p.add_argument("--report", help="записать {имя: сколько лиц взято} в JSON")
        elif name == "purge":
            p.add_argument("out_dir")
        elif name == "remove":
            p.add_argument("person")
        p.add_argument("--roster", default=str(ROSTER_PATH))
    args = parser.parse_args(argv)
    roster_path = Path(args.roster)
    roster = face_roster.FaceRoster.load(roster_path)
    if args.cmd == "list":
        for person, entry in sorted(roster.entries.items()):
            print(f"{person}: {entry['samples']} кадров")
        return 0
    if args.cmd == "remove":
        if roster.entries.pop(args.person, None) is None:
            print("не найден")
            return 1
        roster.save(roster_path)
        print("удалён")
        return 0
    out_dir = Path(args.out_dir)
    if args.cmd == "purge":
        shutil.rmtree(out_dir / "thumbs", ignore_errors=True)
        for name in ("vectors.npy", "faces.json", "review.html"):
            (out_dir / name).unlink(missing_ok=True)
        print("превью и векторы удалены")
        return 0
    faces_data = json.loads((out_dir / "faces.json").read_text(encoding="utf-8"))
    vectors = np.load(out_dir / "vectors.npy")
    assign = json.loads(Path(args.assign).read_text(encoding="utf-8"))
    added = apply_assignment(roster, faces_data, vectors, assign)
    roster.save(roster_path)
    print(json.dumps(added, ensure_ascii=False))
    if args.report:
        Path(args.report).write_text(json.dumps(added, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
