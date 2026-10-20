"""voice_video/face_roster.py: эталоны лиц (векторы), опознание с порогом и запасом, набор эталонов по согласию голоса и плитки."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("face_roster_under_test", ROOT / "voice_video" / "face_roster.py")
fr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fr)

RNG = np.random.default_rng(3)


def person_vector(base, noise=0.25):
    return np.asarray(base) + RNG.normal(scale=noise, size=len(base))


A, B = np.eye(32)[0], np.eye(32)[1]


def test_identify_requires_similarity_and_a_clear_margin_over_the_runner_up():
    roster = fr.FaceRoster()
    roster.add("Водопьянов", A); roster.add("Величко", B)
    assert roster.identify(person_vector(A))[0] == "Водопьянов"
    assert roster.identify(person_vector(B))[0] == "Величко"
    unknown = np.eye(32)[7]
    assert roster.identify(unknown)[0] is None                      # чужое лицо — не гадаем
    between = (A + B) / np.sqrt(2)
    assert roster.identify(between)[0] is None                       # лицо между двумя эталонами — нет запаса
    assert fr.FaceRoster().identify(A) == (None, 0.0)                # пустой список эталонов


def test_adding_samples_averages_the_vector_and_counts_them():
    roster = fr.FaceRoster()
    singles = []
    for _ in range(20):
        sample = person_vector(A, noise=0.4)
        singles.append(float(sample @ A / np.linalg.norm(sample)))
        roster.add("Миронов", sample)
    entry = roster.entries["Миронов"]
    averaged = float(np.asarray(entry["vector"]) @ A)
    assert entry["samples"] == 20 and averaged > 0.8 and averaged > max(singles)   # шум усреднился: ближе любого одиночного кадра


def test_enrollment_uses_only_tiles_that_belong_to_one_voice():
    samples = []
    for _ in range(12):
        samples.append({"tile": "вельчев", "voice": "Величко", "feat": person_vector(B)})        # своя плитка — один голос
    for i in range(12):
        samples.append({"tile": "комната", "voice": "Водопьянов" if i % 2 else "Миронов", "feat": person_vector(A)})  # смесь
    for _ in range(3):
        samples.append({"tile": "редкая", "voice": "Руденко", "feat": person_vector(A)})         # мало кадров
    samples.append({"tile": "вельчев", "voice": None, "feat": person_vector(B)})                 # голос неизвестен — игнор
    roster = fr.FaceRoster()
    added = fr.enroll_from_agreement(samples, roster)
    assert added == {"Величко": 12} and list(roster.entries) == ["Величко"]


def test_roster_file_keeps_only_vectors_and_survives_garbage(tmp_path):
    roster = fr.FaceRoster()
    roster.add("Водопьянов", A)
    path = tmp_path / "data" / "face_roster.json"
    roster.save(path)
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert set(saved["people"]["Водопьянов"]) == {"vector", "samples"}      # ни фото, ни путей к файлам
    assert fr.FaceRoster.load(path).identify(A)[0] == "Водопьянов"
    path.write_text("{битый", encoding="utf-8")
    assert fr.FaceRoster.load(path).entries == {} and fr.FaceRoster.load(None).entries == {}
    assert list(path.parent.glob("*.tmp")) == []
