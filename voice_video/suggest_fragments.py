"""Автоподбор самых полезных для разметки фрагментов длинной записи (с видео).

    python suggest_fragments.py MEDIA OUT_DIR [--count 3] [--minutes 12] [--shift 450] [--min-speakers 4]

Идея: диаризация дважды, с окнами, сдвинутыми на --shift секунд. Где два прогона расходятся — модель
неуверена, там ручная разметка даёт больше всего. К расхождению добавляются перебивания, частые смены
говорящих и речь «редких» голосов (их хуже всего узнавать). Берутся непересекающиеся окна с наибольшей
суммой, в которых слышно не меньше --min-speakers говорящих.

Фрагменты режутся из исходного файла БЕЗ перекодирования (видео остаётся видео; начало — ближайший
ключевой кадр до границы). Рядом пишется manifest.json: время в оригинале, оценка и причины.
Чистая логика (функции ниже) покрыта tests/test_voice_suggest_fragments.py.
"""
from __future__ import annotations

import argparse
import collections
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

Segment = Dict[str, object]


def best_mapping(reference: Sequence[Segment], hypothesis: Sequence[Segment]) -> Dict[str, str]:
    """Метка гипотезы -> метка эталона (максимум общего времени; венгерский алгоритм)."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    ref_labels = sorted({str(s["speaker"]) for s in reference})
    hyp_labels = sorted({str(s["speaker"]) for s in hypothesis})
    if not ref_labels or not hyp_labels:
        return {}
    ri = {label: i for i, label in enumerate(ref_labels)}
    hi = {label: i for i, label in enumerate(hyp_labels)}
    overlap = np.zeros((len(hyp_labels), len(ref_labels)))
    ref_sorted = sorted(reference, key=lambda s: float(s["start"]))
    for h in hypothesis:
        hs, he = float(h["start"]), float(h["end"])
        for r in ref_sorted:
            if float(r["start"]) >= he:
                break
            shared = min(he, float(r["end"])) - max(hs, float(r["start"]))
            if shared > 0:
                overlap[hi[str(h["speaker"])], ri[str(r["speaker"])]] += shared
    rows, cols = linear_sum_assignment(-overlap)
    return {hyp_labels[r]: ref_labels[c] for r, c in zip(rows, cols) if overlap[r, c] > 0}


def _first_label_per_second(segments: Sequence[Segment], mapper, length: int) -> List[Optional[str]]:
    grid: List[Optional[str]] = [None] * length
    for seg in sorted(segments, key=lambda s: float(s["start"])):
        label = mapper(str(seg["speaker"]))
        for k in range(max(0, int(float(seg["start"]))), min(length, int(float(seg["end"])) + 1)):
            if grid[k] is None:
                grid[k] = label
    return grid


def disagreement_per_minute(first: Sequence[Segment], second: Sequence[Segment], shift: float) -> List[float]:
    """Секунд расхождения в каждой минуте шкалы ``first``.

    ``second`` снят с записи без первых ``shift`` секунд, поэтому его время сдвигается на ``shift``.
    Расхождение: оба прогона слышат речь, но метки (после оптимального сопоставления) разные — 1 с;
    речь только у одного прогона — 0.5 с. Первые ``shift`` секунд не сравниваются (в ``second`` их нет).
    """
    a = [{"start": max(float(s["start"]), shift), "end": float(s["end"]), "speaker": s["speaker"]}
         for s in first if float(s["end"]) > shift]
    b = [{"start": float(s["start"]) + shift, "end": float(s["end"]) + shift, "speaker": s["speaker"]} for s in second]
    if not a and not b:
        return []
    length = int(max(float(s["end"]) for s in a + b)) + 1
    mapping = best_mapping(a, b)
    grid_a = _first_label_per_second(a, lambda x: x, length)
    grid_b = _first_label_per_second(b, lambda x: mapping.get(x, "?" + x), length)
    seconds = [0.0] * length
    for k in range(length):
        if grid_a[k] is not None and grid_b[k] is not None:
            seconds[k] = 1.0 if grid_a[k] != grid_b[k] else 0.0
        elif (grid_a[k] is None) != (grid_b[k] is None):
            seconds[k] = 0.5
    return [sum(seconds[i:i + 60]) for i in range(0, length, 60)]


def minute_features(final: Sequence[Segment], overlap: Sequence[Segment], minutes: int,
                    rare_threshold: float = 120.0) -> Dict[str, list]:
    """Посекундные признаки трудности по минутам: перебивания, смены говорящих, речь редких голосов."""
    total: Dict[str, float] = collections.Counter()
    for seg in final:
        total[str(seg["speaker"])] += float(seg["end"]) - float(seg["start"])
    rare = {label for label, seconds in total.items() if seconds < rare_threshold}
    frames: Dict[int, set] = collections.defaultdict(set)
    for seg in overlap:
        for k in range(int(float(seg["start"])), int(float(seg["end"])) + 1):
            frames[k].add(str(seg["speaker"]))
    overlapped = [0.0] * minutes
    for k, labels in frames.items():
        if len(labels) >= 2 and k // 60 < minutes:
            overlapped[k // 60] += 1
    changes, rare_speech = [0] * minutes, [0.0] * minutes
    speakers: List[Dict[str, float]] = [collections.defaultdict(float) for _ in range(minutes)]
    previous = None
    for seg in sorted(final, key=lambda s: float(s["start"])):
        minute = min(minutes - 1, int(float(seg["start"]) // 60))
        label = str(seg["speaker"])
        speakers[minute][label] += float(seg["end"]) - float(seg["start"])
        if previous is not None and previous != label:
            changes[minute] += 1
        previous = label
        if label in rare:
            rare_speech[minute] += float(seg["end"]) - float(seg["start"])
    return {"overlap": overlapped, "changes": changes, "rare": rare_speech, "speakers": speakers}


def score_minutes(disagree: Sequence[float], features: Dict[str, list]) -> List[float]:
    minutes = len(features["overlap"])
    dis = list(disagree) + [0.0] * max(0, minutes - len(disagree))
    return [dis[i] * 1.0 + features["overlap"][i] * 0.5 + features["rare"][i] * 0.5 + features["changes"][i] * 0.2
            for i in range(minutes)]


def pick_windows(scores: Sequence[float], speakers: Sequence[Dict[str, float]], window_minutes: int,
                 count: int, min_speakers: int = 4, min_speaker_seconds: float = 20.0) -> List[Tuple[int, float]]:
    """(первая минута, оценка) непересекающихся окон с наибольшей суммой оценок."""
    candidates = []
    for start in range(0, len(scores) - window_minutes + 1):
        merged: Dict[str, float] = collections.defaultdict(float)
        for minute in range(start, start + window_minutes):
            for label, seconds in speakers[minute].items():
                merged[label] += seconds
        if sum(1 for seconds in merged.values() if seconds >= min_speaker_seconds) < min_speakers:
            continue
        candidates.append((sum(scores[start:start + window_minutes]), start))
    chosen: List[Tuple[int, float]] = []
    for score, start in sorted(candidates, reverse=True):
        if all(abs(start - other) >= window_minutes for other, _ in chosen):
            chosen.append((start, score))
        if len(chosen) == count:
            break
    return sorted(chosen)


# --- запуск ---------------------------------------------------------------------

def _ffmpeg() -> str:
    local = Path(__file__).resolve().parent / "ffmpeg" / "bin" / "ffmpeg.exe"
    return str(local) if local.exists() else "ffmpeg"


def _diarize(wav: Path, chunk: float, overlap: float):
    """Чанковая диаризация тем же кодом, что и в проде (кэш окон рядом с wav)."""
    from modules.audio_processor import ProcessingConfig
    from modules.diarization import SpeakerDiarization

    cfg = ProcessingConfig(
        enable_ai_analysis=False, enable_speaker_identification=False, prompt_for_unknown_speakers=False,
        diarization_exclusive=True, speaker_embeddings_improved=True, use_checkpoints=True,
        diarization_chunk_seconds=chunk, diarization_chunk_threshold_seconds=0,
        diarization_chunk_overlap_seconds=overlap,
    )
    result = SpeakerDiarization(cfg).perform_diarization(str(wav))
    if result is None:
        raise RuntimeError("Диаризация не дала результата")
    return result


def cut_fragment(media: Path, dst: Path, start: float, duration: float) -> None:
    subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(media),
                    "-t", f"{duration:.3f}", "-map", "0:v:0?", "-map", "0:a?", "-c", "copy",
                    "-avoid_negative_ts", "make_zero", str(dst)], check=True, capture_output=True, text=True, timeout=7200)


def suggest(media: Path, out_dir: Path, *, count: int = 3, minutes: int = 12, shift: float = 450.0,
            min_speakers: int = 4, chunk: float = 900.0, overlap: float = 30.0) -> Dict[str, object]:
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "_work"
    work.mkdir(exist_ok=True)
    base_wav, shifted_wav = work / "base.wav", work / "shifted.wav"
    subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(media), "-vn", "-map", "0:a:0",
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(base_wav)], check=True, timeout=14400)
    subprocess.run([_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{shift:.3f}", "-i", str(base_wav),
                    "-c", "copy", str(shifted_wav)], check=True, timeout=14400)
    first = _diarize(base_wav, chunk, overlap)
    second = _diarize(shifted_wav, chunk, overlap)
    final = [dict(t) for t in first]
    minute_count = int(max(float(t["end"]) for t in final) // 60) + 1
    features = minute_features(final, [dict(t) for t in first.overlap_segments], minute_count)
    disagree = disagreement_per_minute(final, [dict(t) for t in second], shift)
    scores = score_minutes(disagree, features)
    picks = pick_windows(scores, features["speakers"], minutes, count, min_speakers)
    fragments = []
    for start_minute, score in picks:
        start = start_minute * 60.0
        span = slice(start_minute, start_minute + minutes)
        name = f"{media.stem}_{int(start // 60):03d}-{int(start // 60) + minutes:03d}min{media.suffix}"
        cut_fragment(media, out_dir / name, start, minutes * 60.0)
        fragments.append({
            "file": name, "start_s": start, "end_s": start + minutes * 60.0, "score": round(score),
            "disagree_s": round(sum(disagree[span])), "overlap_s": round(sum(features["overlap"][span])),
            "rare_speech_s": round(sum(features["rare"][span])), "changes": sum(features["changes"][span]),
        })
    manifest = {"source": str(media), "minutes": minutes, "shift_s": shift, "labels_found": first.metadata.get("speakers_count"),
                "fragments": fragments}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Подобрать трудные фрагменты записи для разметки")
    parser.add_argument("media")
    parser.add_argument("out_dir")
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--minutes", type=int, default=12)
    parser.add_argument("--shift", type=float, default=450.0)
    parser.add_argument("--min-speakers", type=int, default=4)
    args = parser.parse_args(argv)
    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    result = suggest(Path(args.media), Path(args.out_dir), count=args.count, minutes=args.minutes,
                     shift=args.shift, min_speakers=args.min_speakers)
    for item in result["fragments"]:
        print(f"{item['file']}: {item['start_s'] / 60:.0f}-{item['end_s'] / 60:.0f} мин, оценка {item['score']}, "
              f"расхождение {item['disagree_s']} с, перебивания {item['overlap_s']} с, редкие голоса {item['rare_speech_s']} с")
    return 0


if __name__ == "__main__":
    sys.exit(main())
