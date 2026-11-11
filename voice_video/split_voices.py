"""Разделить «склеенные» диаризацией голоса по подсветке плиток и вырезать образцы голоса каждого человека.

    python split_voices.py TRANSCRIPT.json SPANS.json AUDIO.wav OUT_DIR [--max-seconds 60]

* TRANSCRIPT.json — *_transcript.json прогона; SPANS.json — отрезки подсветки плиток (video_speaker_hints.run()['spans']);
* для каждого голоса, подсвечивающего несколько плиток (mixed), сегменты делятся по плитке, и в OUT_DIR/<голос>/<плитка>.wav
  собираются самые длинные сегменты (до --max-seconds) — это образцы для эталона голоса (кнопка «Голоса» / --enroll-voice);
* OUT_DIR/split_report.json — сколько секунд досталось каждой плитке; ничего в протокол не подставляется.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional, Sequence

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import video_speaker_hints as hints  # noqa: E402


def safe_name(text: str) -> str:
    return re.sub(r"[^\w\-. ]+", "", text, flags=re.UNICODE).strip()[:60] or "tile"


def split(transcript: Path, spans_path: Path, audio: Path, out_dir: Path, max_seconds: float = 60.0, min_segment: float = 2.0):
    from pydub import AudioSegment

    segments = json.loads(transcript.read_text(encoding="utf-8"))["segments"]
    spans = json.loads(spans_path.read_text(encoding="utf-8"))
    canon = hints.canonical_names(spans)
    spans = [dict(s, name=canon.get(s["name"], s["name"])) for s in spans]
    turns = [{"start": float(s.get("start", s.get("start_time"))), "end": float(s.get("end", s.get("end_time"))),
              "speaker": str(s["speaker"])} for s in segments]
    summary = hints.summarize_hints(spans, turns)
    mixed = [m["speaker"] for m in summary["mixed"]]
    normalized = [dict(s, start=t["start"], end=t["end"]) for s, t in zip(segments, turns)]
    assigned = hints.split_mixed_segments(normalized, spans, mixed)
    wav = AudioSegment.from_file(str(audio))
    report = {}
    for voice in mixed:
        groups: dict = {}
        for index, tile in assigned.items():
            if turns[index]["speaker"] == voice:
                groups.setdefault(tile, []).append(turns[index])
        report[voice] = {}
        for tile, items in groups.items():
            total = sum(t["end"] - t["start"] for t in items)
            report[voice][tile] = round(total, 1)
            chosen, taken = [], 0.0
            for t in sorted(items, key=lambda x: x["end"] - x["start"], reverse=True):
                if t["end"] - t["start"] < min_segment or taken >= max_seconds:
                    continue
                chosen.append(t)
                taken += t["end"] - t["start"]
            if not chosen:
                continue
            clip = AudioSegment.empty()
            for t in sorted(chosen, key=lambda x: x["start"]):
                clip += wav[int(t["start"] * 1000):int(t["end"] * 1000)] + AudioSegment.silent(200)
            target = out_dir / safe_name(voice)
            target.mkdir(parents=True, exist_ok=True)
            clip.export(str(target / f"{safe_name(tile)}.wav"), format="wav")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "split_report.json").write_text(json.dumps({"mixed": summary["mixed"], "seconds_by_tile": report},
                                                          ensure_ascii=False, indent=1), encoding="utf-8")
    return summary["mixed"], report


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("transcript")
    parser.add_argument("spans")
    parser.add_argument("audio")
    parser.add_argument("out_dir")
    parser.add_argument("--max-seconds", type=float, default=60.0)
    args = parser.parse_args(argv)
    mixed, report = split(Path(args.transcript), Path(args.spans), Path(args.audio), Path(args.out_dir), args.max_seconds)
    print(json.dumps({"mixed": [m["speaker"] for m in mixed], "seconds_by_tile": report}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
