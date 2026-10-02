"""
Черновик диаризации для веб-редактора разметки (HUB-IT /voice → «Разметка»).

Диаризация идёт по СЫРОМУ звуку (16 кГц моно, без сепаратора вокала):
сепаратор нужен распознаванию слов, а pyannote различает людей по тембру,
который сепаратор может искажать. Текст (опционально) — как в основном
пайплайне: сепарация → нормализация → STT, затем слова раскладываются по
репликам диаризации.

Использование:
    python label_draft.py <медиа> --out <папка> [--with-text] [--num-speakers N]
                          [--min-speakers N] [--max-speakers N]
                          [--stt-engine whisper|gemini|grok|mai] [--separator kim|...|none]

Результат: <папка>/draft.json и <папка>/audio.mp3 (для плеера в браузере).
"""

import argparse
import bisect
import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("label_draft")

DRAFT_FILE = "draft.json"
AUDIO_FILE = "audio.mp3"
MERGE_GAP_SEC = 0.3  # склеивать соседние реплики одного спикера с паузой не длиннее
WORD_SNAP_SEC = 1.0  # слово вне реплик — к ближайшей реплике, если она не дальше


# ---------------------------------------------------------------------------
# Чистые функции (покрыты тестами, без torch)
# ---------------------------------------------------------------------------

def merge_turns(turns: List[Dict], gap: float = MERGE_GAP_SEC) -> List[Dict]:
    """Сортирует реплики и склеивает соседние реплики одного спикера через короткую паузу."""
    clean = []
    for t in turns or []:
        try:
            start, end = float(t["start"]), float(t["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end > start:
            clean.append({"start": start, "end": end, "speaker": str(t.get("speaker") or "SPEAKER_UNKNOWN")})
    clean.sort(key=lambda t: (t["start"], t["end"]))

    merged: List[Dict] = []
    last_by_speaker: Dict[str, Dict] = {}
    for t in clean:
        prev = merged[-1] if merged else None
        if prev and prev["speaker"] == t["speaker"] and t["start"] - prev["end"] <= gap:
            prev["end"] = max(prev["end"], t["end"])
            continue
        # Тот же спикер, перекрытие с его же предыдущей репликой — продлить её.
        same = last_by_speaker.get(t["speaker"])
        if same is not None and t["start"] <= same["end"]:
            same["end"] = max(same["end"], t["end"])
            continue
        item = dict(t)
        merged.append(item)
        last_by_speaker[t["speaker"]] = item
    return merged


def attach_words(turns: List[Dict], words: List[Dict], snap: float = WORD_SNAP_SEC) -> List[Dict]:
    """Раскладывает слова STT по репликам: по середине слова, иначе к ближайшей реплике.

    При наложении реплик слово уходит в ту, что началась позже (обычно это
    перебивающий говорящий, у которого реплика короче).
    """
    result = [dict(t, text="") for t in turns]
    if not result:
        return result
    starts = [t["start"] for t in result]
    buckets: List[List[str]] = [[] for _ in result]

    for w in words or []:
        text = str(w.get("word") or w.get("text") or "").strip()
        if not text or w.get("start") is None or w.get("end") is None:
            continue
        try:
            mid = (float(w["start"]) + float(w["end"])) / 2
        except (TypeError, ValueError):
            continue
        idx = bisect.bisect_right(starts, mid) - 1
        window = range(idx, max(-1, idx - 16), -1)  # реплики, начавшиеся до слова
        chosen: Optional[int] = None
        for j in window:
            if result[j]["start"] <= mid < result[j]["end"]:
                chosen = j
                break
        if chosen is None:
            # Ближайшая реплика: длинная реплика с перебивкой внутри может
            # закончиться ближе к слову, чем последняя начавшаяся.
            best, best_dist = None, snap
            for j in list(window) + [idx + 1]:
                if 0 <= j < len(result):
                    t = result[j]
                    dist = t["start"] - mid if mid < t["start"] else mid - t["end"]
                    if dist <= best_dist:
                        best, best_dist = j, dist
            chosen = best
        if chosen is not None:
            buckets[chosen].append(text)

    for t, bucket in zip(result, buckets):
        t["text"] = " ".join(bucket)
    return result


def build_draft(turns: List[Dict], words: Optional[List[Dict]], duration: Optional[float]) -> Dict:
    """Итоговый draft.json: сегменты с id, округлённые таймкоды, список спикеров."""
    merged = merge_turns(turns)
    segments = attach_words(merged, words) if words else [dict(t, text="") for t in merged]
    out = []
    for i, seg in enumerate(segments, 1):
        end = seg["end"]
        if duration:
            end = min(end, float(duration))
        if end <= seg["start"]:
            continue
        out.append({
            "id": f"s{i}",
            "start": round(seg["start"], 3),
            "end": round(end, 3),
            "speaker": seg["speaker"],
            "text": seg.get("text", ""),
        })
    speakers = sorted({s["speaker"] for s in out})
    return {
        "version": 1,
        "duration": round(float(duration), 3) if duration else None,
        "audio": AUDIO_FILE,
        "diarization_audio": "raw",
        "speakers": speakers,
        "segments": out,
    }


def words_from_transcription(result: Dict) -> List[Dict]:
    """Слова из результата STT; без пословных таймкодов — сегменты целиком."""
    words = [w for w in (result or {}).get("word_segments") or [] if w.get("start") is not None]
    if words:
        return words
    return [
        {"word": s.get("text", ""), "start": s.get("start"), "end": s.get("end")}
        for s in (result or {}).get("segments") or []
    ]


# ---------------------------------------------------------------------------
# Запуск (тяжёлые импорты — только здесь)
# ---------------------------------------------------------------------------

def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Черновик диаризации для редактора разметки")
    parser.add_argument("media", help="Аудио/видео файл")
    parser.add_argument("--out", required=True, help="Папка результата (draft.json, audio.mp3)")
    parser.add_argument("--with-text", action="store_true", help="Добавить текст реплик (STT)")
    parser.add_argument("--num-speakers", type=int, default=0)
    parser.add_argument("--min-speakers", type=int, default=0)
    parser.add_argument("--max-speakers", type=int, default=0)
    parser.add_argument("--stt-engine", default=None)
    parser.add_argument("--separator", default=None)
    parser.add_argument("--language", default="ru")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)

    from run import (
        bootstrap_local_ffmpeg,
        bootstrap_local_model_cache,
        bootstrap_local_site_packages,
        bootstrap_torch_compat,
        configure_console_encoding,
        configure_logging,
    )
    configure_console_encoding()
    bootstrap_local_site_packages()
    bootstrap_local_ffmpeg()
    bootstrap_local_model_cache()
    bootstrap_torch_compat()
    configure_logging(args.log_level)

    media = Path(args.media)
    out_dir = Path(args.out)
    if not media.exists():
        print(f"❌ Файл не найден: {media}")
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)

    import config as app_config
    from pydub import AudioSegment
    from modules.audio_processor import AudioProcessor, ProcessingConfig, cleanup_memory
    from modules.diarization import SpeakerDiarization

    separator = args.separator or getattr(app_config, "SEPARATOR_ENGINE", "kim")
    cfg = ProcessingConfig(
        enable_ai_analysis=False,
        enable_speaker_identification=False,
        prompt_for_unknown_speakers=False,
        stt_engine=args.stt_engine or getattr(app_config, "STT_ENGINE", "whisper"),
        stt_chunk_seconds=getattr(app_config, "STT_CHUNK_SECONDS", 900),
        stt_cut_silence=getattr(app_config, "STT_CUT_SILENCE", True),
        whisper_model=getattr(app_config, "DEFAULT_WHISPER_MODEL", "large-v3"),
        language=args.language,
        separator_engine=separator,
        enable_demucs=separator != "none",
        diarization_num_speakers=args.num_speakers or getattr(app_config, "DIARIZATION_NUM_SPEAKERS", 0) or 0,
        diarization_clustering_threshold=getattr(app_config, "DIARIZATION_CLUSTERING_THRESHOLD", None),
        diarization_min_duration_off=getattr(app_config, "DIARIZATION_MIN_DURATION_OFF", None),
    )
    if args.min_speakers:
        cfg.diarization_min_speakers = args.min_speakers
    if args.max_speakers:
        cfg.diarization_max_speakers = args.max_speakers

    audio_processor = AudioProcessor(cfg)
    raw_wav = out_dir / "raw.wav"
    processed_wav = out_dir / "processed.wav"
    try:
        print("🎵 Этап 1: Извлечение аудио (16 кГц моно, без сепарации)...", flush=True)
        if not audio_processor.extract_audio(str(media), str(raw_wav)):
            print("❌ Не удалось извлечь аудио")
            return 1
        raw_audio = AudioSegment.from_wav(str(raw_wav))
        duration = len(raw_audio) / 1000.0
        raw_audio.export(str(out_dir / AUDIO_FILE), format="mp3", bitrate="64k")
        del raw_audio

        print("👥 Этап 3: Диаризация по сырому звуку...", flush=True)
        turns = SpeakerDiarization(cfg).perform_diarization(str(raw_wav))
        cleanup_memory()
        if not turns:
            print("❌ Диаризация не дала результата")
            return 1

        words = None
        if args.with_text:
            print("📝 Этап 2: Транскрипция для подсказки текста...", flush=True)
            from modules.transcription import TranscriptionProcessor
            if not audio_processor.process_audio(str(media), str(processed_wav)):
                print("⚠️ Обработка аудио для STT не удалась — текст будет по сырому звуку")
                processed_wav = raw_wav
            stt_cfg = cfg
            stt_cfg.enable_diarization = False  # диаризация уже сделана по сырому звуку
            stt = TranscriptionProcessor(stt_cfg.whisper_model, stt_cfg).transcribe_audio(
                str(processed_wav), args.language
            )
            words = words_from_transcription(stt)
            cleanup_memory()
            if not words:
                print("⚠️ STT не вернул текст — черновик без текста")

        draft = build_draft(turns, words, duration)
        tmp = out_dir / (DRAFT_FILE + ".tmp")
        tmp.write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
        tmp.replace(out_dir / DRAFT_FILE)
        print(
            f"✅ Черновик готов: {len(draft['segments'])} реплик, "
            f"{len(draft['speakers'])} спикеров, {duration / 60:.1f} мин",
            flush=True,
        )
        return 0
    finally:
        for tmp_wav in (raw_wav, out_dir / "processed.wav"):
            try:
                tmp_wav.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
