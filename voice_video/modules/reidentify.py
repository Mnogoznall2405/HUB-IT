"""Пореплечная проверка голосов по эталонам: исправляет остаточные склейки диаризации.

Диаризация (и чанковая тоже) может слить похожие голоса в одну метку, а идентификация называет метку целиком по усреднённому
вектору. Здесь каждая реплика сравнивается с эталонами отдельно и переименовывается, только если голос ЯВНО принадлежит
другому эталону. Решение осторожное (см. plan_relabel): короткие реплики не трогаем, уверенно названным голосам не мешаем,
пока реплика на них похожа.

Чистая логика (plan_relabel) покрыта tests/test_voice_reidentify.py; reidentify() — тонкая обвязка над эмбеддером pipeline.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

UNNAMED_PREFIX = "SPEAKER_"


def plan_relabel(items: Sequence[Dict[str, Any]], *, strict: float = 0.25, margin: float = 0.08, min_duration: float = 3.0,
                 current_ok: float = 0.35) -> Dict[int, str]:
    """{индекс реплики: новое имя}.

    items — {"index", "speaker", "duration", "distances": {имя эталона: косинусное расстояние}}.
    Заменяем, если: реплика ≥ min_duration, лучший эталон ближе strict и заметно (margin) лучше второго, а у уже названного
    голоса реплика далека от его эталона (> current_ok). Безымянные метки (SPEAKER_xx) заменяем по тому же порогу.
    """
    plan: Dict[int, str] = {}
    for item in items:
        distances = {k: float(v) for k, v in (item.get("distances") or {}).items() if v is not None}
        if float(item.get("duration") or 0.0) < min_duration or not distances:
            continue
        ranked = sorted(distances.items(), key=lambda kv: kv[1])
        best, best_distance = ranked[0]
        second_distance = ranked[1][1] if len(ranked) > 1 else 1.0
        if best_distance > strict or second_distance - best_distance < margin:
            continue
        current = str(item.get("speaker") or "")
        if current == best:
            continue
        if current in distances and distances[current] <= current_ok:
            continue          # реплика всё ещё похожа на эталон текущей метки — не трогаем
        plan[int(item["index"])] = best
    return plan


def reidentify(audio_file: str, segments: List[Dict[str, Any]], diarizer, reference_dir, *, strict: float = 0.25, margin: float = 0.08,
               min_duration: float = 3.0, current_ok: float = 0.35, max_segments: int = 6000) -> Dict[str, Any]:
    """Переименовывает реплики на месте. Возвращает {"changed": n, "by_name": {...}, "checked": n}."""
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.spatial.distance import cosine

    if not getattr(diarizer, "embedding_inference", None):
        diarizer.load_embedding_model()
    references = diarizer._load_reference_embeddings(reference_dir, expected_dim=None)
    if not references:
        return {"changed": 0, "checked": 0, "by_name": {}}
    info = sf.info(audio_file)
    sample_rate = info.samplerate
    items = []
    for index, seg in enumerate(segments[:max_segments]):
        start = float(seg.get("start", seg.get("start_time", 0.0)))
        end = float(seg.get("end", seg.get("end_time", start)))
        if end - start < min_duration:
            continue
        audio, _ = sf.read(audio_file, start=int(start * sample_rate), stop=int(end * sample_rate), dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        try:
            vector = diarizer._embedding_to_numpy(diarizer.embedding_inference(
                {"waveform": torch.from_numpy(np.ascontiguousarray(audio))[None, :], "sample_rate": sample_rate}))
        except Exception:  # noqa: BLE001 - одна неудачная реплика не должна ломать проверку
            continue
        distances = {name: float(cosine(vector, np.asarray(ref).ravel())) for name, ref in references.items()
                     if np.asarray(ref).ravel().shape == np.asarray(vector).ravel().shape}
        items.append({"index": index, "speaker": seg.get("speaker"), "duration": end - start, "distances": distances})
    plan = plan_relabel(items, strict=strict, margin=margin, min_duration=min_duration, current_ok=current_ok)
    by_name: Dict[str, int] = {}
    for index, name in plan.items():
        segments[index]["speaker"] = name
        segments[index]["reidentified"] = True
        by_name[name] = by_name.get(name, 0) + 1
    return {"changed": len(plan), "checked": len(items), "by_name": by_name}
