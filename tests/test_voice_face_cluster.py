"""voice_video/face_cluster.py + face_enroll.py: группировка лиц по людям и перенос подписанных кластеров в эталоны."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "voice_video"))


def _load(name):
    spec = importlib.util.spec_from_file_location(name + "_under_test", ROOT / "voice_video" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fc, fe = _load("face_cluster"), _load("face_enroll")
import face_roster  # noqa: E402

RNG = np.random.default_rng(5)
A, B, C = np.eye(64)[0], np.eye(64)[1], np.eye(64)[2]


def noisy(base, n, noise=0.1):
    return [base + RNG.normal(scale=noise, size=len(base)) for _ in range(n)]


def test_clusters_group_one_person_together_and_split_different_people():
    vectors = noisy(A, 12) + noisy(B, 9) + noisy(A, 6) + noisy(C, 4)   # лица одного человека перемешаны по записи
    groups = fc.cluster_vectors(vectors)
    person = lambda i: 0 if i < 12 or 21 <= i < 27 else 1 if i < 21 else 2
    assert [sorted({person(i) for i in g}) for g in groups] == [[0], [1], [2]]   # каждый кластер — один человек
    assert [len(g) for g in groups] == [18, 9, 4]


def test_assignment_takes_named_clusters_drops_excluded_and_outlier_faces_and_skips_deleted():
    vectors = np.asarray(noisy(A, 10) + noisy(B, 8) + noisy(C, 6) + [B])        # последний вектор (B) лежит в кластере «А»: чужое лицо
    data = {"clusters": [{"id": 0, "faces": list(range(10)) + [24]}, {"id": 1, "faces": list(range(10, 18))},
                         {"id": 2, "faces": list(range(18, 24))}]}
    assign = {"0": {"name": "Миронов", "delete": False, "excluded": [0]},
              "1": {"name": "", "delete": False, "excluded": []},              # без имени — пропуск
              "2": {"name": "Случайный", "delete": True, "excluded": []}}
    roster = face_roster.FaceRoster()
    added = fe.apply_assignment(roster, data, vectors, assign)
    assert added == {"Миронов": 9}                                             # 11 лиц − 1 убранное − 1 чужое по расстоянию до центра
    assert roster.identify(A)[0] == "Миронов" and list(roster.entries) == ["Миронов"]


def test_clips_around_speech_skip_the_silent_hours(tmp_path):
    # Реплики в первые 10 минут и через 5 часов: между ними пустой экран — видео читается только вокруг речи.
    segments = tmp_path / "turns.json"
    segments.write_text('[{"start": 5, "end": 600}, {"start": 18000, "end": 18300}]', encoding="utf-8")
    clips = fc.clips_around_speech(["rec.mp4,0,20000"], segments)
    assert [c.split(",")[0] for c in clips] == ["rec.mp4", "rec.mp4"]
    starts = [float(c.split(",")[1]) for c in clips]
    assert starts[0] == 0.0 and 17900 < starts[1] <= 18000
    assert sum(float(c.split(",")[2]) for c in clips) < 1500
