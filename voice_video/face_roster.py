"""Эталоны лиц сотрудников для ВКС: «кто сидит за этой плиткой» (дополняет подпись плитки и голос).

Биометрические персональные данные: включается отдельно (``FACE_HINTS=1``) и только после согласования с ИБ/юристами.
Фотографии не сохраняются — только числовые векторы (по одному усреднённому на человека) в ``data/face_roster.json``.
Модели — открытые из OpenCV Zoo: YuNet (детектор лиц, MIT) и SFace (вектор лица, Apache-2.0); работают локально на CPU.

Эталоны набираются без ручной разметки: ``enroll_from_agreement`` берёт кадры, где подсвечена плитка с одним лицом
и в этот момент звучит голос, названный по эталону голоса. Чистая логика (FaceRoster, enroll_from_agreement)
покрыта tests/test_voice_face_roster.py.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_MODELS = Path(__file__).resolve().parent / "data" / "face_models"
YUNET = "face_detection_yunet_2023mar.onnx"
SFACE = "face_recognition_sface_2021dec.onnx"


def _unit(vector) -> "Any":
    import numpy as np

    arr = np.asarray(vector, dtype=np.float64).ravel()
    norm = float(np.linalg.norm(arr))
    return arr / norm if norm > 0 else arr


class FaceRoster:
    """Усреднённый вектор лица на человека (+ сколько кадров в него вошло)."""

    def __init__(self, entries: Optional[Dict[str, Dict[str, Any]]] = None):
        self.entries: Dict[str, Dict[str, Any]] = entries or {}

    @classmethod
    def load(cls, path: Optional[Path]) -> "FaceRoster":
        if not path:
            return cls()
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls()
        people = data.get("people") if isinstance(data, dict) else None
        return cls({str(n): e for n, e in (people or {}).items()
                    if isinstance(e, dict) and isinstance(e.get("vector"), list) and e["vector"]})

    def save(self, path: Path) -> None:
        """Атомарная запись; в файле только векторы и счётчики."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"version": 1, "people": self.entries}, handle, ensure_ascii=False)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def add(self, name: str, vector, weight: int = 1) -> None:
        import numpy as np

        new = _unit(vector)
        entry = self.entries.get(name)
        if entry is None:
            self.entries[name] = {"vector": new.tolist(), "samples": int(weight)}
            return
        old = np.asarray(entry["vector"]) * entry["samples"]
        total = entry["samples"] + weight
        self.entries[name] = {"vector": _unit(old + new * weight).tolist(), "samples": int(total)}

    def identify(self, vector, *, min_similarity: float = 0.40, min_margin: float = 0.08) -> Tuple[Optional[str], float]:
        """(имя, похожесть). Имя — только если лучший эталон достаточно похож и заметно лучше второго."""
        import numpy as np

        if not self.entries:
            return None, 0.0
        probe = _unit(vector)
        scores = sorted(((float(probe @ np.asarray(e["vector"])), n) for n, e in self.entries.items()), reverse=True)
        best, name = scores[0]
        runner_up = scores[1][0] if len(scores) > 1 else -1.0
        if best >= min_similarity and best - runner_up >= min_margin:
            return name, round(best, 3)
        return None, round(best, 3)


def enroll_from_agreement(samples: Iterable[Dict[str, Any]], roster: FaceRoster, *, min_faces: int = 8,
                          min_share: float = 0.8) -> Dict[str, int]:
    """Набирает эталоны по кадрам {voice, feat}: имя берётся из голоса, если плитка уверенно «принадлежит» одному голосу.

    Плитка (``tile``) — положение/подпись; её лица должны принадлежать одному человеку по голосу (≥ min_share кадров),
    иначе плитка смешанная (комната или общий аккаунт с разными людьми) и в эталоны не идёт.
    Возвращает {имя: сколько кадров добавлено}.
    """
    by_tile: Dict[Any, List[Dict[str, Any]]] = {}
    for sample in samples:
        if sample.get("voice") and sample.get("feat") is not None:
            by_tile.setdefault(sample.get("tile"), []).append(sample)
    added: Dict[str, int] = {}
    for tile, items in by_tile.items():
        counts: Dict[str, int] = {}
        for item in items:
            counts[item["voice"]] = counts.get(item["voice"], 0) + 1
        voice, top = max(counts.items(), key=lambda kv: kv[1])
        if len(items) < min_faces or top / len(items) < min_share:
            continue
        for item in items:
            if item["voice"] == voice:
                roster.add(voice, item["feat"])
                added[voice] = added.get(voice, 0) + 1
    return added


# --- модели OpenCV (лениво: чистая логика выше от cv2 не зависит) ------------------

class FaceEmbedder:
    def __init__(self, models_dir: Optional[Path] = None):
        import cv2

        models = Path(models_dir) if models_dir else DEFAULT_MODELS
        self._cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(models / YUNET), "", (320, 320), 0.85, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(models / SFACE), "")

    def largest_face_vector(self, rgb_crop, min_size: int = 28):
        """Вектор самого крупного лица в кадре плитки или None (лица нет / слишком мелкое)."""
        import numpy as np

        crop = self._cv2.cvtColor(np.asarray(rgb_crop), self._cv2.COLOR_RGB2BGR)
        if crop.shape[0] < 60 or crop.shape[1] < 60:
            return None
        self.detector.setInputSize((crop.shape[1], crop.shape[0]))
        _, faces = self.detector.detect(crop)
        if faces is None or not len(faces):
            return None
        face = max(faces, key=lambda row: row[2] * row[3])
        if face[2] < min_size or face[3] < min_size:
            return None
        return _unit(self.recognizer.feature(self.recognizer.alignCrop(crop, face)))
