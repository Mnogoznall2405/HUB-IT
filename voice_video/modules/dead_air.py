"""Пропуск мёртвых участков записи ВКС (пустой рабочий стол, тишина) перед тяжёлой обработкой звука.

Запись бывает на много часов длиннее встречи (22.07: 18 ч записи, звук только в ~40 минутах), а нормализация громкости
считается по всей длине. Здесь находятся участки без звука дольше ``min_seconds``; из них вырезается середина (по
``keep_seconds`` с краёв остаётся), звук нормализуется без них, а потом на их место возвращается тишина — длина файла и
тайм-коды транскрипта, клипов и видео-подсказок не меняются.

Чистая логика (dead_ranges) покрыта tests/test_voice_dead_air.py.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Sequence, Tuple

ACTIVE_RMS = 0.001      # ниже — цифровая тишина/шум пустого канала (на реальных записях 0.0000–0.0001, речь 0.01+)
MIN_LOUD_SECONDS = 1    # минута считается живой, если в ней есть хотя бы столько секунд звука (короткий возглас тоже сохраняем)
BLOCK_SECONDS = 600


def dead_ranges(active_minutes: Sequence[bool], total_seconds: float, *, min_seconds: float = 600.0,
                keep_seconds: float = 60.0) -> List[Tuple[int, int]]:
    """Секунды [начало, конец) для вырезания: серии неживых минут не короче min_seconds, без краёв по keep_seconds."""
    ranges: List[Tuple[int, int]] = []
    run_start = None
    for minute, alive in list(enumerate(active_minutes)) + [(len(active_minutes), True)]:
        if not alive and run_start is None:
            run_start = minute
        elif alive and run_start is not None:
            begin, end = run_start * 60, min(minute * 60, int(total_seconds))
            run_start = None
            if end - begin >= min_seconds:
                cut_begin = begin + (int(keep_seconds) if begin > 0 else 0)      # от начала файла запас не нужен
                cut_end = end - (int(keep_seconds) if end < int(total_seconds) else 0)
                if cut_end - cut_begin >= min_seconds / 2:
                    ranges.append((cut_begin, cut_end))
    return ranges


def scan_minutes(path: str) -> Tuple[List[bool], float, int]:
    """([минута живая?], длительность в секундах, частота) — читает файл блоками, память не копится."""
    import numpy as np
    import soundfile as sf

    flags: List[bool] = []
    leftover = np.zeros(0, dtype=np.float32)
    with sf.SoundFile(path) as f:
        rate = f.samplerate
        total = f.frames / rate
        while True:
            block = f.read(rate * BLOCK_SECONDS, dtype="float32", always_2d=True)
            if len(block) == 0:
                break
            mono = np.concatenate([leftover, block.mean(axis=1)])
            seconds = len(mono) // rate
            per_second = np.sqrt((mono[:seconds * rate].reshape(seconds, rate) ** 2).mean(axis=1))
            leftover = mono[seconds * rate:]
            loud = per_second >= ACTIVE_RMS
            for i in range(0, seconds, 60):
                flags.append(int(loud[i:i + 60].sum()) >= MIN_LOUD_SECONDS)
    return flags, total, rate


def compact(src: str, dst: str, ranges: Sequence[Tuple[int, int]]) -> None:
    """Копия src без участков ranges (секунды)."""
    import soundfile as sf

    with sf.SoundFile(src) as f, sf.SoundFile(dst, "w", samplerate=f.samplerate, channels=f.channels, subtype=f.subtype) as out:
        rate, position = f.samplerate, 0
        for begin, end in list(ranges) + [(None, None)]:
            stop = f.frames if begin is None else begin * rate
            while position < stop:
                data = f.read(min(rate * 60, stop - position), dtype="float32", always_2d=True)
                if len(data) == 0:
                    break
                out.write(data)
                position += len(data)
            if end is not None:
                f.seek(end * rate)
                position = end * rate


def expand(path: str, ranges: Sequence[Tuple[int, int]]) -> None:
    """Возвращает на место вырезанных участков тишину (файл заменяется на месте): длина как у исходной записи."""
    import soundfile as sf

    temp = str(Path(path).with_suffix(".expanded.wav"))
    with sf.SoundFile(path) as f, sf.SoundFile(temp, "w", samplerate=f.samplerate, channels=f.channels, subtype=f.subtype) as out:
        rate = f.samplerate
        cursor = 0                                   # сколько секунд исходной записи уже записано
        for begin, end in ranges:
            _copy(f, out, (begin - cursor) * rate)  # живой кусок до этой тишины
            _silence(out, (end - begin) * rate, f.channels)
            cursor = end
        _copy(f, out, None)
    Path(temp).replace(path)


def _copy(src, out, frames) -> None:
    left = frames
    while left is None or left > 0:
        data = src.read(src.samplerate * 60 if left is None else min(src.samplerate * 60, left), dtype="float32", always_2d=True)
        if len(data) == 0:
            break
        out.write(data)
        if left is not None:
            left -= len(data)


def _silence(out, frames: int, channels: int) -> None:
    import numpy as np

    block = np.zeros((min(frames, 16000 * 60), channels), dtype="float32")
    while frames > 0:
        n = min(frames, len(block))
        out.write(block[:n])
        frames -= n


def find(path: str, min_seconds: float) -> Tuple[List[Tuple[int, int]], float]:
    """(участки для вырезания, длительность записи); пусто — вырезать нечего."""
    flags, total, _ = scan_minutes(path)
    return dead_ranges(flags, total, min_seconds=min_seconds), total
