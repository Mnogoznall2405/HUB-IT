"""
Нарезка видео-клипов под поручения из реестра.

Для каждой строки таблицы «Реестр поручений»:
1. Берётся таймкод темы (колонка «Время»).
2. Внутри сегментов темы ищется реплика, наиболее похожая на формулировку
   поручения (пересечение слов, без LLM).
3. ffmpeg вырезает клип ~±20с вокруг найденного момента из исходного видео.
4. Таймкод в таблице заменяется на markdown-ссылку на файл клипа:
   [00:13:44](clips/clip_01_00-13-44.mp4)

source_parts — список исходных видео с кумулятивными оффсетами
(для объединённых встреч): [{'path': 'part1.mp4', 'offset': 0.0},
                            {'path': 'part2.mp4', 'offset': 3696.2}]
"""

import logging
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from config import PROCESSED_DIR, INPUT_DIR

logger = logging.getLogger(__name__)

CLIP_PAD_BEFORE = 20.0   # секунд до найденной реплики
CLIP_PAD_AFTER = 20.0    # секунд после неё
CLIP_FALLBACK_LEN = 50.0 # длина клипа при фолбэке на начало темы
MATCH_THRESHOLD = 0.2    # минимальная доля совпавших слов для точного момента

_ROW_RE = re.compile(r"^(\s*\|\s*\d+\s*\|)([^|]*)(\|.*)$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_WORD_RE = re.compile(r"[0-9a-zA-Zа-яА-ЯёЁ]{4,}")
_VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".ts", ".mp3", ".wav", ".m4a")


def _strip_link(text: str) -> str:
    return _LINK_RE.sub(r"\1", str(text)).strip()


def _parse_hms(token: str) -> Optional[float]:
    token = token.strip()
    m = re.match(r"^(\d{1,3}):(\d{2})(?::(\d{2}))?$", token)
    if not m:
        return None
    a, b, c = int(m.group(1)), int(m.group(2)), m.group(3)
    if c is not None:
        return a * 3600 + b * 60 + int(c)
    return a * 60 + b


def _row_time_seconds(cell_text: str) -> Optional[float]:
    """Первый таймкод из ячейки «Время» (там может быть диапазон a–b)."""
    cell = _strip_link(cell_text)
    for tok in re.split(r"[–—\-]", cell):
        t = _parse_hms(tok)
        if t is not None:
            return t
    return _parse_hms(cell)


def _words(text: str) -> set:
    return set(_WORD_RE.findall(str(text).lower()))


def _seg_start(s: Dict[str, Any]) -> float:
    return float(s.get("start", s.get("start_time", 0)) or 0)


def _seg_end(s: Dict[str, Any]) -> float:
    return float(s.get("end", s.get("end_time", 0)) or 0)


def _find_topic(t: float, topics: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], bool]:
    """Возвращает (тема, содержит_ли_t). Таймкод реестра = начало темы, но
    LLM может округлить/слить темы — тогда ищем ближайшую вперёд."""
    for tp in topics:
        ts, te = tp.get("start_time"), tp.get("end_time")
        if ts is not None and te is not None and ts - 1 <= t <= te + 1:
            return tp, True
    best, best_d = None, float("inf")
    for tp in topics:
        ts = tp.get("start_time")
        if ts is None or ts < t - 1:
            continue
        d = ts - t
        if d < best_d:
            best, best_d = tp, d
    return best, False


def _find_moment(task_text: str, t_start: float, t_end: float,
                 segments: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], float]:
    """Сегмент транскрипта внутри окна темы, лучше всего похожий на формулировку."""
    tw = _words(task_text)
    if not tw:
        return None, 0.0
    best_seg, best_score = None, 0.0
    for s in segments:
        st, en = _seg_start(s), _seg_end(s)
        if en < t_start - 5 or st > t_end + 5:
            continue
        sw = _words(s.get("text", ""))
        if not sw:
            continue
        score = len(tw & sw) / len(tw)
        if score > best_score:
            best_seg, best_score = s, score
    return best_seg, best_score


def _resolve_video_path(path: str) -> Optional[Path]:
    p = Path(path)
    if p.exists():
        return p
    for d in (Path(PROCESSED_DIR), Path(INPUT_DIR)):
        cand = d / p.name
        if cand.exists():
            return cand
    return None


def find_video_for_base(base: str) -> Optional[Path]:
    """Исходное видео по имени встречи: processed/<base>.<ext> или input/<base>.<ext>."""
    for d in (Path(PROCESSED_DIR), Path(INPUT_DIR)):
        for ext in _VIDEO_EXTS:
            p = d / f"{base}{ext}"
            if p.exists():
                return p
    return None


def _map_to_source(t: float, source_parts: List[Dict[str, Any]]) -> Tuple[str, float]:
    """Сквозное время -> (видео-файл, локальное время в нём)."""
    parts = sorted(source_parts, key=lambda p: p.get("offset", 0.0))
    part = parts[0]
    for p in parts:
        if t >= p.get("offset", 0.0):
            part = p
        else:
            break
    return part.get("path", ""), t - part.get("offset", 0.0)


def _fmt_file_t(t: float) -> str:
    t = int(t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}-{m:02d}-{s:02d}"


def _fmt_display_t(t: float) -> str:
    t = int(t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _cut_clip(video: Path, t_start: float, dur: float, out_path: Path) -> bool:
    """Точная нарезка: -ss до -i + перекодирование NVENC, фолбэки на libx264/m4a.

    По умолчанию H.264 cq33 (играет в любом браузере, ~30% меньше cq30).
    Переопределения через env: CLIPS_CQ=30, CLIPS_HEVC=1.
    """
    import os
    cq = os.environ.get("CLIPS_CQ", "33")
    base_cmd = [
        "ffmpeg", "-y", "-ss", f"{t_start:.2f}", "-i", str(video),
        "-t", f"{dur:.2f}", "-movflags", "+faststart",
        "-loglevel", "error", "-nostdin",
    ]
    audio = ["-ac", "1", "-c:a", "aac", "-b:a", "48k"]
    attempts = []
    if os.environ.get("CLIPS_HEVC"):
        attempts.append(base_cmd + ["-c:v", "hevc_nvenc", "-preset", "p6",
                                    "-cq", cq] + audio + [str(out_path)])
    attempts += [
        base_cmd + ["-c:v", "h264_nvenc", "-preset", "p6",
                    "-cq", cq] + audio + [str(out_path)],
        base_cmd + ["-c:v", "libx264", "-preset", "veryfast",
                    "-crf", cq] + audio + [str(out_path)],
        base_cmd + ["-vn"] + audio + [str(out_path.with_suffix(".m4a"))],
    ]
    for cmd in attempts:
        try:
            subprocess.run(cmd, check=True, timeout=300,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception:
            continue
    return False


def attach_assignment_clips(registry_md: str,
                            topics: List[Dict[str, Any]],
                            segments: List[Dict[str, Any]],
                            source_parts: List[Dict[str, Any]],
                            meeting_dir: Path) -> str:
    """Вставляет ссылки на видео-клипы в колонку «Время» реестра поручений.

    Возвращает обновлённый markdown реестра. При любой ошибке — исходный текст.
    """
    try:
        if not registry_md or not segments or not source_parts:
            return registry_md
        parts = [{"path": str(_resolve_video_path(p.get("path", "")) or p.get("path", "")),
                  "offset": float(p.get("offset", 0.0))}
                 for p in source_parts if p.get("path")]
        if not parts:
            return registry_md

        clips_dir = Path(meeting_dir) / "clips"
        lines = registry_md.split("\n")
        made = 0
        for i, line in enumerate(lines):
            m = _ROW_RE.match(line)
            if not m:
                continue
            time_cell = m.group(2).strip()
            t = _row_time_seconds(time_cell)
            if t is None:
                continue
            cells = [c.strip() for c in m.group(3).strip().strip("|").split("|")]
            task_text = _strip_link(cells[0]) if cells else ""

            topic, contained = _find_topic(t, topics or [])
            if topic and contained:
                t_start = float(topic.get("start_time") or t)
                t_end = float(topic.get("end_time") or (t + 120))
            else:
                # таймкод между темами — ищем реплику в ближайшие 3 минуты
                t_start, t_end = t, t + 180.0
            seg, score = _find_moment(task_text, t_start, t_end, segments)
            if seg is not None and score >= MATCH_THRESHOLD:
                # ячейка «Время» = реальный момент реплики, клип — ±20с вокруг
                display_t = _seg_start(seg)
                global_start = max(0.0, display_t - CLIP_PAD_BEFORE)
                global_end = _seg_end(seg) + CLIP_PAD_AFTER
            else:
                # фолбэк: номинальное время строки (LLM выбирает его из диапазона темы)
                display_t = t
                global_start = max(0.0, t - CLIP_PAD_BEFORE)
                global_end = global_start + CLIP_FALLBACK_LEN

            video_path, local_start = _map_to_source(global_start, parts)
            vpath = Path(video_path)
            if not vpath.exists():
                continue
            local_dur = max(5.0, global_end - global_start)

            made += 1
            clip_name = f"clip_{made:02d}_{_fmt_file_t(local_start)}.mp4"
            out_path = clips_dir / clip_name
            clips_dir.mkdir(parents=True, exist_ok=True)
            if not out_path.exists():
                if not _cut_clip(vpath, local_start, local_dur, out_path):
                    if out_path.with_suffix(".m4a").exists():
                        clip_name = out_path.with_suffix(".m4a").name
                    else:
                        made -= 1
                        continue
            display = _fmt_display_t(display_t)
            lines[i] = f"{m.group(1)} [{display}](clips/{clip_name}) {m.group(3)}"

        logger.info(f"🎬 Видео-клипы поручений: {made} шт -> {clips_dir}")
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"❌ Ошибка нарезки клипов поручений: {e}", exc_info=True)
        return registry_md
