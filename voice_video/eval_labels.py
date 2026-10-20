"""Регресс диаризации на ваших ручных разметках: «стало лучше или хуже» одним запуском.

    python eval_labels.py export gold.json                      # сохранённые разметки из БД (только чтение)
    python eval_labels.py run gold.json --baseline base.json    # DER/путаница сейчас против эталонного прогона
    python eval_labels.py run gold.json --baseline base.json --update-baseline   # принять текущее как базу

Каждый размеченный фрагмент гоняется двумя режимами: целиком («single») и чанками по --chunk секунд
(«chunked», проверяет сшивку). Коды выхода: 0 — не хуже базы (с допуском --tolerance), 1 — хуже, 2 — ошибка.
Чистое сравнение с базой (compare_to_baseline) покрыто tests/test_voice_eval_labels.py.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
METRICS = ("der", "confusion")


def compare_to_baseline(current: Dict[str, Dict[str, float]], baseline: Dict[str, Dict[str, float]],
                        tolerance: float = 0.005) -> List[Dict[str, object]]:
    """Список регрессий: метрика режима выросла больше допуска. Режимы без базы пропускаются."""
    problems = []
    for mode, metrics in current.items():
        base = baseline.get(mode)
        if not base:
            continue
        for name in METRICS:
            if name in metrics and name in base and metrics[name] > base[name] + tolerance:
                problems.append({"mode": mode, "metric": name, "baseline": base[name], "current": metrics[name],
                                 "delta": round(metrics[name] - base[name], 4)})
    return problems


def weighted(rows: Sequence[Dict[str, float]], key: str) -> float:
    total = sum(r["speech"] for r in rows)
    return sum(r[key] * r["speech"] for r in rows) / total if total else 0.0


def export_gold(out: Path) -> int:
    sys.path.insert(0, str(ROOT))
    from voice_server import label_store

    gold = []
    for row in label_store.list_projects(limit=500):
        project = label_store.get_project(row["id"])
        if not project or not project.get("edited_at") or not project.get("segments"):
            continue
        audio = HERE / "labeling" / project["id"] / "audio.mp3"
        if not audio.exists():
            continue
        gold.append({"id": project["id"], "title": project.get("title"), "duration": project.get("duration"),
                     "segments": project["segments"], "audio": str(audio)})
    out.write_text(json.dumps(gold, ensure_ascii=False), encoding="utf-8")
    print(f"Сохранено разметок: {len(gold)}")
    return 0


def run_eval(gold_path: Path, baseline_path: Optional[Path], update: bool, chunk: float, overlap: float,
             tolerance: float, work: Path) -> int:
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(ROOT))
    from voice_server import labeling_metrics
    from modules.audio_processor import ProcessingConfig
    from modules.diarization import SpeakerDiarization

    gold = json.loads(gold_path.read_text(encoding="utf-8"))
    work.mkdir(parents=True, exist_ok=True)
    ffmpeg = HERE / "ffmpeg" / "bin" / "ffmpeg.exe"
    cfg = ProcessingConfig(
        enable_ai_analysis=False, enable_speaker_identification=False, prompt_for_unknown_speakers=False,
        diarization_exclusive=True, speaker_embeddings_improved=True, use_checkpoints=False,
        diarization_chunk_seconds=0, diarization_chunk_threshold_seconds=0, diarization_chunk_overlap_seconds=overlap,
    )
    diarizer = SpeakerDiarization(cfg)
    rows: Dict[str, List[Dict[str, float]]] = {"single": [], "chunked": []}
    for project in gold:
        wav = work / f"{project['id']}.wav"
        subprocess.run([str(ffmpeg) if ffmpeg.exists() else "ffmpeg", "-y", "-loglevel", "error", "-i", project["audio"],
                        "-ac", "1", "-ar", "16000", str(wav)], check=True)
        for mode in rows:
            cfg.diarization_chunk_seconds = chunk if mode == "chunked" else 0
            result = diarizer.perform_diarization(str(wav))
            hyp = [{"start": t["start"], "end": t["end"], "speaker": t["speaker"]} for t in (result or [])]
            m = labeling_metrics.diarization_error(project["segments"], hyp, collar=0.25)
            rows[mode].append({"der": m["der"] or 0.0, "confusion": m["confusion"] or 0.0,
                               "speech": m["reference_speech_sec"]})
            print(f"{str(project['title'])[:36]:36} {mode:8} DER={m['der']:.3f} путаница={m['confusion']:.3f}", flush=True)
    current = {mode: {name: round(weighted(items, name), 4) for name in METRICS} for mode, items in rows.items() if items}
    print("ИТОГО:", json.dumps(current, ensure_ascii=False))
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path and baseline_path.exists() else {}
    problems = compare_to_baseline(current, baseline, tolerance)
    for p in problems:
        print(f"РЕГРЕСС {p['mode']}/{p['metric']}: было {p['baseline']}, стало {p['current']} (+{p['delta']})")
    if update and baseline_path:
        baseline_path.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
        print("База обновлена:", baseline_path)
        return 0
    if baseline and not problems:
        print("Не хуже базы.")
    return 1 if problems else 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Регресс диаризации на ручных разметках")
    sub = parser.add_subparsers(dest="cmd", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("out")
    run = sub.add_parser("run")
    run.add_argument("gold")
    run.add_argument("--baseline")
    run.add_argument("--update-baseline", action="store_true")
    run.add_argument("--chunk", type=float, default=240.0)
    run.add_argument("--overlap", type=float, default=30.0)
    run.add_argument("--tolerance", type=float, default=0.005)
    run.add_argument("--work", default=str(HERE / "temp" / "eval_labels"))
    args = parser.parse_args(argv)
    try:
        if args.cmd == "export":
            return export_gold(Path(args.out))
        return run_eval(Path(args.gold), Path(args.baseline) if args.baseline else None, args.update_baseline,
                        args.chunk, args.overlap, args.tolerance, Path(args.work))
    except Exception as exc:  # noqa: BLE001 - CLI: код 2 и понятное сообщение
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
