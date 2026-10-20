"""Вырезание длинных тихих мест из записи встречи (видео без перекодирования, звук — как есть).

    python cut_silence.py SRC DST [--min-silence 20] [--keep 2] [--noise -38] [--dry-run]

Что делает:
  1. ffmpeg silencedetect находит паузы длиннее --min-silence секунд;
  2. из каждой паузы убирается середина: по --keep секунд тишины остаётся рядом с речью;
  3. границы реза у видео ставятся на ключевые кадры (рез без перекодирования, поэтому быстро
     и без потери качества); вырезается только то, что целиком лежит внутри паузы;
  4. рядом с DST пишется DST.silence_map.json — карта времён «новое ↔ оригинал»,
     чтобы таймкоды протокола возвращались к исходной записи.

Чистые функции (parse_silences, plan_removals, kept_segments, build_map, to_original, to_new)
покрыты tests/test_voice_cut_silence.py; сам рез — реальным ffmpeg на синтетическом видео.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

Interval = Tuple[float, float]

_HERE = Path(__file__).resolve().parent
_SILENCE_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?[\d.]+)")


def _tool(name: str) -> str:
    local = _HERE / "ffmpeg" / "bin" / f"{name}.exe"
    return str(local) if local.exists() else name


def parse_silences(stderr_text: str, duration: float) -> List[Interval]:
    """Паузы из вывода silencedetect; пауза без конца (до конца файла) закрывается длительностью."""
    silences: List[Interval] = []
    start: Optional[float] = None
    for line in stderr_text.splitlines():
        m = _SILENCE_START.search(line)
        if m:
            start = max(0.0, float(m.group(1)))
            continue
        m = _SILENCE_END.search(line)
        if m and start is not None:
            silences.append((start, min(duration, float(m.group(1)))))
            start = None
    if start is not None and start < duration:
        silences.append((start, duration))
    return [(a, b) for a, b in silences if b > a]


def plan_removals(
    silences: Sequence[Interval],
    duration: float,
    *,
    min_silence: float = 20.0,
    keep: float = 2.0,
    keyframes: Optional[Sequence[float]] = None,
    min_cut: float = 1.0,
) -> List[Interval]:
    """Интервалы, которые вырезаются. Каждый целиком лежит внутри паузы, у речи остаётся ``keep`` секунд.

    С ``keyframes`` начало вырезаемого куска — первый ключевой кадр не раньше (пауза + keep), а конец
    (с него продолжается запись) — последний ключевой кадр не позже (конец паузы − keep): тогда ни кадр
    речи, ни её хвост не режутся, а новая запись начинается точно на ключевом кадре.
    """
    kf = sorted(keyframes) if keyframes else None
    removals: List[Interval] = []
    for start, end in silences:
        if end - start < min_silence:
            continue
        a = 0.0 if start <= 0.0 else start + keep
        b = duration if end >= duration - 1e-6 else end - keep
        if kf is not None:
            if a > 0.0:
                a = next((t for t in kf if t >= a), None)
            if a is None:
                continue
            if b < duration:
                b = max((t for t in kf if t <= b), default=None)
            if b is None:
                continue
        if b - a >= min_cut:
            removals.append((a, b))
    return removals


def kept_segments(removals: Sequence[Interval], duration: float) -> List[Interval]:
    out: List[Interval] = []
    position = 0.0
    for a, b in sorted(removals):
        if a > position + 1e-6:
            out.append((position, a))
        position = max(position, b)
    if duration > position + 1e-6:
        out.append((position, duration))
    return out


def build_map(kept: Sequence[Interval], durations: Optional[Sequence[float]] = None) -> List[Dict[str, float]]:
    """Карта «новое ↔ оригинал». ``durations`` — реальные длины склеенных кусков (иначе планируемые)."""
    rows, new_start = [], 0.0
    for index, (start, end) in enumerate(kept):
        rows.append({"orig_start": round(start, 3), "orig_end": round(end, 3), "new_start": round(new_start, 3)})
        new_start += durations[index] if durations is not None else end - start
    return rows


def to_original(time_map: Sequence[Dict[str, float]], new_time: float) -> float:
    """Время в вырезанной записи -> время в оригинале."""
    for row in reversed(time_map):
        if new_time >= row["new_start"]:
            return min(row["orig_end"], row["orig_start"] + (new_time - row["new_start"]))
    return time_map[0]["orig_start"] if time_map else new_time


def to_new(time_map: Sequence[Dict[str, float]], orig_time: float) -> Optional[float]:
    """Время в оригинале -> в вырезанной записи (None — момент попал в вырезанную тишину)."""
    for row in time_map:
        if row["orig_start"] <= orig_time <= row["orig_end"]:
            return row["new_start"] + (orig_time - row["orig_start"])
    return None


# --- ffmpeg ------------------------------------------------------------------

def probe(src: Path) -> Dict[str, object]:
    out = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration:stream=codec_type",
         "-of", "json", str(src)],
        capture_output=True, text=True, check=True, timeout=300,
    ).stdout
    data = json.loads(out)
    kinds = {s.get("codec_type") for s in data.get("streams", [])}
    return {"duration": float(data["format"]["duration"]), "video": "video" in kinds, "audio": "audio" in kinds}


def detect_silences(src: Path, duration: float, noise_db: float, min_silence: float) -> List[Interval]:
    proc = subprocess.run(
        [_tool("ffmpeg"), "-hide_banner", "-nostats", "-i", str(src), "-map", "0:a:0",
         "-af", f"silencedetect=noise={noise_db}dB:d={max(0.5, min_silence / 4):.2f}", "-f", "null", "-"],
        capture_output=True, text=True, timeout=7200,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg silencedetect failed: {proc.stderr[-300:]}")
    return parse_silences(proc.stderr, duration)


def video_keyframes(src: Path) -> List[float]:
    proc = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
         "-of", "csv=p=0", str(src)],
        capture_output=True, text=True, timeout=1800,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe keyframes failed: {proc.stderr[-300:]}")
    times = []
    for line in proc.stdout.splitlines():
        parts = line.strip().split(",")
        if len(parts) >= 2 and "K" in parts[1] and parts[0] not in ("", "N/A"):
            times.append(float(parts[0]))
    return sorted(times)


def _duration(path: Path) -> float:
    return float(probe(path)["duration"])


def cut_segments(src: Path, dst: Path, kept: Sequence[Interval], *, video: bool) -> List[float]:
    """Склеивает ``kept`` в ``dst``; возвращает реальные длительности кусков (для карты времён).

    Видео режется одним проходом segment-muxer'ом по ключевым кадрам без перекодирования: прежняя схема
    «-ss/-t на каждый кусок» на ключевом кадре в конце куска захватывала лишний GOP (~7 с дубля на стыке).
    Звук — с точностью до пакета (~20 мс).
    """
    ffmpeg = _tool("ffmpeg")
    with tempfile.TemporaryDirectory(dir=str(dst.parent)) as tmp:
        tmp_dir = Path(tmp)
        if video:
            duration = kept[-1][1]
            bounds = sorted({t for start, end in kept for t in (start, end) if 0.0 < t < duration - 1e-6})
            pattern = tmp_dir / f"seg_%05d{dst.suffix}"
            cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-map", "0:v:0", "-map", "0:a?",
                   "-c", "copy", "-f", "segment", "-reset_timestamps", "1",
                   # граница чуть раньше ключевого кадра: сам кадр уже в следующем куске
                   "-segment_times", ",".join(f"{t - 0.02:.3f}" for t in bounds), str(pattern)]
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=14400)
            files = sorted(tmp_dir.glob(f"seg_*{dst.suffix}"))
            if len(files) != len(bounds) + 1:
                raise RuntimeError(f"segment muxer дал {len(files)} кусков вместо {len(bounds) + 1}")
            parts = []
            for start, _ in kept:
                index = 0 if start <= 1e-6 else min(range(len(bounds)), key=lambda j: abs(bounds[j] - start)) + 1
                parts.append(files[index])
        else:
            parts = []
            for index, (start, end) in enumerate(kept):
                part = tmp_dir / f"part_{index:04d}{dst.suffix}"
                cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(src),
                       "-t", f"{end - start:.3f}", "-vn", "-c:a", "pcm_s16le" if dst.suffix.lower() == ".wav" else "aac"]
                subprocess.run(cmd + [str(part)], check=True, capture_output=True, text=True, timeout=7200)
                parts.append(part)
        durations = [_duration(part) for part in parts]
        listing = tmp_dir / "list.txt"
        listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
        subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", str(listing), "-c", "copy", str(dst)],
                       check=True, capture_output=True, text=True, timeout=14400)
    return durations


def cut_silence(src: Path, dst: Optional[Path], *, min_silence: float = 20.0, keep: float = 2.0,
                noise_db: float = -38.0, dry_run: bool = False) -> Dict[str, object]:
    info = probe(src)
    duration = float(info["duration"])
    silences = detect_silences(src, duration, noise_db, min_silence)
    keyframes = video_keyframes(src) if info["video"] else None
    removals = plan_removals(silences, duration, min_silence=min_silence, keep=keep, keyframes=keyframes)
    kept = kept_segments(removals, duration)
    time_map = build_map(kept)
    removed = sum(b - a for a, b in removals)
    summary = {
        "source": str(src), "duration": round(duration, 2), "removed_seconds": round(removed, 2),
        "result_seconds": round(duration - removed, 2), "removals": len(removals), "segments": len(kept),
        "silences_found": len(silences), "min_silence": min_silence, "keep": keep, "noise_db": noise_db,
    }
    if dry_run or dst is None or not removals:
        return {**summary, "time_map": time_map, "written": False}
    durations = cut_segments(src, dst, kept, video=bool(info["video"]))
    time_map = build_map(kept, durations)
    summary["result_seconds"] = round(sum(durations), 2)
    map_path = dst.with_name(dst.name + ".silence_map.json")
    map_path.write_text(json.dumps({**summary, "time_map": time_map}, ensure_ascii=False, indent=1), encoding="utf-8")
    return {**summary, "time_map": time_map, "written": True, "map_file": str(map_path)}


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Вырезать длинные тихие места из записи")
    parser.add_argument("src")
    parser.add_argument("dst", nargs="?")
    parser.add_argument("--min-silence", type=float, default=20.0, help="паузы короче (с) не трогаем")
    parser.add_argument("--keep", type=float, default=2.0, help="сколько секунд тишины оставить рядом с речью")
    parser.add_argument("--noise", type=float, default=-38.0, help="порог тишины, дБ")
    parser.add_argument("--dry-run", action="store_true", help="только посчитать, ничего не писать")
    args = parser.parse_args(argv)
    if not args.dry_run and not args.dst:
        parser.error("нужен DST (или --dry-run)")
    result = cut_silence(Path(args.src), Path(args.dst) if args.dst else None, min_silence=args.min_silence,
                         keep=args.keep, noise_db=args.noise, dry_run=args.dry_run)
    print(json.dumps({k: v for k, v in result.items() if k != "time_map"}, ensure_ascii=False, indent=1))
    print(f"Вырезано {result['removed_seconds'] / 60:.1f} мин из {result['duration'] / 60:.1f} "
          f"({result['removals']} пауз), останется {result['result_seconds'] / 60:.1f} мин"
          + ("" if result["written"] else " — файл не записан"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
