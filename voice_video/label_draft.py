"""
Черновик диаризации для веб-редактора разметки (HUB-IT /voice → «Разметка»).

Диаризация идёт по СЫРОМУ звуку (16 кГц моно, без сепаратора вокала):
сепаратор нужен распознаванию слов, а pyannote различает людей по тембру,
который сепаратор может искажать. Текст (опционально) — как в основном
пайплайне: сепарация → нормализация → STT, затем слова раскладываются по
репликам диаризации.

Режимы:
    --mode draft    черновик: draft.json, audio.mp3 (плеер), peaks.json (волна)
    --mode variant  ещё один вариант диаризации для сравнения (--audio raw|processed):
                    variant_<имя>.json
    --mode samples  образцы голосов по размеченным репликам (--samples-spec spec.json):
                    samples/<метка>.wav — для записи в эталоны reference_voices
    --mode calibrate похожесть голосов размеченных сотрудников с каждым эталоном
                    (--samples-spec, тем же способом, что в протоколах): calibration.json

Использование:
    python label_draft.py <медиа> --out <папка> [--mode draft] [--with-text]
                          [--num-speakers N] [--min-speakers N] [--max-speakers N]
                          [--stt-engine whisper|gemini|grok|mai] [--separator kim|...|none]
"""

import argparse
import bisect
import json
import logging
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("label_draft")

DRAFT_FILE = "draft.json"
CALIBRATION_FILE = "calibration.json"
AUDIO_FILE = "audio.mp3"
PEAKS_FILE = "peaks.json"
VARIANT_PREFIX = "variant_"
SAMPLES_DIR = "samples"
PEAKS_STEP_SEC = 0.1
SAMPLE_MAX_SEC = 30.0  # эталон голоса: до 30 с самых длинных реплик
SAMPLE_MIN_SPAN_SEC = 1.5
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


def pick_sample_spans(spans: List[List[float]], max_total: float = SAMPLE_MAX_SEC,
                      min_span: float = SAMPLE_MIN_SPAN_SEC) -> List[List[float]]:
    """Самые длинные реплики спикера для эталона голоса, суммарно не длиннее max_total."""
    clean = []
    for span in spans or []:
        try:
            start, end = float(span[0]), float(span[1])
        except (TypeError, ValueError, IndexError):
            continue
        if end - start >= min_span:
            clean.append([start, end])
    clean.sort(key=lambda sp: sp[1] - sp[0], reverse=True)
    picked, total = [], 0.0
    for start, end in clean:
        if total >= max_total:
            break
        take = min(end - start, max_total - total)
        picked.append([start, start + take])
        total += take
    return sorted(picked)


def peaks_from_samples(samples, sample_rate: int, step: float = PEAKS_STEP_SEC) -> List[int]:
    """Огибающая для волны в редакторе: максимум |x| на окно, 0..100."""
    import numpy as np

    data = np.abs(np.asarray(samples, dtype=np.float32))
    window = max(1, int(sample_rate * step))
    n = len(data) // window
    if n == 0:
        return []
    env = data[: n * window].reshape(n, window).max(axis=1)
    top = float(np.percentile(env, 99)) or float(env.max()) or 1.0
    return [int(v) for v in np.clip(env / top * 100.0, 0, 100).round()]


# ---------------------------------------------------------------------------
# Запуск (тяжёлые импорты — только здесь)
# ---------------------------------------------------------------------------

def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Черновик диаризации для редактора разметки")
    parser.add_argument("media", help="Аудио/видео файл")
    parser.add_argument("--out", required=True, help="Папка проекта разметки")
    parser.add_argument("--mode", choices=("draft", "variant", "samples", "calibrate"), default="draft",
                        help="draft — черновик; variant — доп. вариант диаризации для сравнения; "
                             "samples — образцы голосов для эталонов; "
                             "calibrate — похожесть размеченных голосов с эталонами")
    parser.add_argument("--audio", choices=("raw", "processed"), default="raw",
                        help="Звук для диаризации/образцов: сырой или после сепаратора")
    parser.add_argument("--variant-name", default="processed")
    parser.add_argument("--exclusive", action="store_true",
                        help="Эксклюзивная разметка community-1 (один говорящий в момент времени)")
    parser.add_argument("--samples-spec", default=None, help="JSON {метка: [[start, end], ...]}")
    parser.add_argument("--with-text", action="store_true", help="Добавить текст реплик (STT)")
    parser.add_argument("--num-speakers", type=int, default=0)
    parser.add_argument("--min-speakers", type=int, default=0)
    parser.add_argument("--max-speakers", type=int, default=0)
    parser.add_argument("--stt-engine", default=None)
    parser.add_argument("--separator", default=None)
    parser.add_argument("--language", default="ru")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args(argv)


def _write_json(path: Path, payload) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


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
    from modules.audio_processor import AudioProcessor, ProcessingConfig

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

    def ensure_raw() -> bool:
        if raw_wav.exists():
            return True
        print("🎵 Этап 1: Извлечение аудио (16 кГц моно, без сепарации)...", flush=True)
        return audio_processor.extract_audio(str(media), str(raw_wav))

    def ensure_processed() -> Path:
        if processed_wav.exists():
            return processed_wav
        print(f"🎵 Этап 1: Извлечение аудио и сепарация ({separator})...", flush=True)
        if audio_processor.process_audio(str(media), str(processed_wav)):
            return processed_wav
        print("⚠️ Сепарация не удалась — используется сырой звук")
        return raw_wav if ensure_raw() else processed_wav

    try:
        if args.mode == "draft":
            return _run_draft(args, cfg, out_dir, ensure_raw, ensure_processed, raw_wav)
        if args.mode == "variant":
            return _run_variant(args, cfg, out_dir, ensure_raw, ensure_processed, raw_wav, separator)
        if args.mode == "calibrate":
            return _run_calibrate(args, cfg, out_dir, ensure_processed, app_config)
        return _run_samples(args, out_dir, ensure_raw, ensure_processed, raw_wav)
    finally:
        for tmp_wav in (raw_wav, processed_wav):
            try:
                tmp_wav.unlink(missing_ok=True)
            except OSError:
                pass


def _diarize(cfg, wav: Path) -> List[Dict]:
    from modules.audio_processor import cleanup_memory
    from modules.diarization import SpeakerDiarization

    turns = SpeakerDiarization(cfg).perform_diarization(str(wav))
    cleanup_memory()
    return turns or []


def _run_draft(args, cfg, out_dir: Path, ensure_raw, ensure_processed, raw_wav: Path) -> int:
    from pydub import AudioSegment
    from modules.audio_processor import cleanup_memory

    if not ensure_raw():
        print("❌ Не удалось извлечь аудио")
        return 1
    raw_audio = AudioSegment.from_wav(str(raw_wav))
    duration = len(raw_audio) / 1000.0
    raw_audio.export(str(out_dir / AUDIO_FILE), format="mp3", bitrate="64k")
    try:
        _write_json(out_dir / PEAKS_FILE, {
            "step": PEAKS_STEP_SEC,
            "peaks": peaks_from_samples(raw_audio.get_array_of_samples(), raw_audio.frame_rate),
        })
    except Exception as exc:  # волна — удобство, не повод валить черновик
        print(f"⚠️ Волна не построена: {exc}")
    del raw_audio

    print("👥 Этап 3: Диаризация по сырому звуку...", flush=True)
    turns = _diarize(cfg, raw_wav)
    if not turns:
        print("❌ Диаризация не дала результата")
        return 1

    words = None
    if args.with_text:
        print("📝 Этап 2: Транскрипция для подсказки текста...", flush=True)
        from modules.transcription import TranscriptionProcessor
        stt_audio = ensure_processed()
        cfg.enable_diarization = False  # диаризация уже сделана по сырому звуку
        stt = TranscriptionProcessor(cfg.whisper_model, cfg).transcribe_audio(str(stt_audio), args.language)
        words = words_from_transcription(stt)
        cleanup_memory()
        if not words:
            print("⚠️ STT не вернул текст — черновик без текста")

    draft = build_draft(turns, words, duration)
    _write_json(out_dir / DRAFT_FILE, draft)
    print(
        f"✅ Черновик готов: {len(draft['segments'])} реплик, "
        f"{len(draft['speakers'])} спикеров, {duration / 60:.1f} мин",
        flush=True,
    )
    return 0


def _run_variant(args, cfg, out_dir: Path, ensure_raw, ensure_processed, raw_wav: Path, separator: str) -> int:
    if args.audio == "processed":
        wav = ensure_processed()
    else:
        if not ensure_raw():
            print("❌ Не удалось извлечь аудио")
            return 1
        wav = raw_wav
    cfg.diarization_exclusive = bool(args.exclusive)
    print(f"👥 Этап 3: Диаризация варианта «{args.variant_name}» ({args.audio})...", flush=True)
    turns = _diarize(cfg, wav)
    if not turns:
        print("❌ Диаризация не дала результата")
        return 1
    draft = build_draft(turns, None, None)
    payload = {
        "name": args.variant_name,
        "audio": args.audio,
        "separator": separator if args.audio == "processed" else "none",
        "exclusive": bool(args.exclusive),
        "num_speakers": cfg.diarization_num_speakers or None,
        "min_speakers": cfg.diarization_min_speakers,
        "max_speakers": cfg.diarization_max_speakers,
        "segments": draft["segments"],
    }
    _write_json(out_dir / f"{VARIANT_PREFIX}{args.variant_name}.json", payload)
    print(f"✅ Вариант готов: {len(draft['segments'])} реплик, {len(draft['speakers'])} спикеров", flush=True)
    return 0


def _run_samples(args, out_dir: Path, ensure_raw, ensure_processed, raw_wav: Path) -> int:
    from pydub import AudioSegment

    if not args.samples_spec:
        print("❌ Не задан --samples-spec")
        return 1
    spec = json.loads(Path(args.samples_spec).read_text(encoding="utf-8"))
    wav = ensure_processed() if args.audio == "processed" else (raw_wav if ensure_raw() else None)
    if not wav or not Path(wav).exists():
        print("❌ Не удалось подготовить аудио")
        return 1
    audio = AudioSegment.from_wav(str(wav))
    samples_dir = out_dir / SAMPLES_DIR
    samples_dir.mkdir(exist_ok=True)
    made = 0
    for label, spans in (spec or {}).items():
        if not re.match(r"^[A-Za-z0-9_-]{1,64}$", str(label)):
            continue
        picked = pick_sample_spans(spans)
        if not picked:
            print(f"⚠️ {label}: нет реплик длиннее {SAMPLE_MIN_SPAN_SEC} с")
            continue
        sample = AudioSegment.silent(duration=0)
        for start, end in picked:
            if len(sample):
                sample += AudioSegment.silent(duration=250)
            sample += audio[int(start * 1000):int(end * 1000)]
        sample.set_channels(1).set_frame_rate(16000).export(str(samples_dir / f"{label}.wav"), format="wav")
        made += 1
        print(f"🎧 Образец {label}: {len(sample) / 1000:.0f} с", flush=True)
    print(f"✅ Образцов голосов: {made}", flush=True)
    return 0 if made else 1


def _run_calibrate(args, cfg, out_dir: Path, ensure_processed, app_config) -> int:
    """Похожесть (1 - косинусное расстояние) каждого размеченного голоса с каждым эталоном.

    Эмбеддинги — тем же способом, что при автоопределении в протоколах
    (звук после сепаратора, SPEAKER_EMBEDDINGS_IMPROVED из .env).
    """
    from datetime import datetime, timezone
    from scipy.spatial.distance import cosine
    from modules.diarization import SpeakerDiarization

    spec = json.loads(Path(args.samples_spec).read_text(encoding="utf-8")) if args.samples_spec else {}
    segments = []
    names = {}
    for label, item in (spec or {}).items():
        if not re.match(r"^[A-Za-z0-9_-]{1,64}$", str(label)) or not isinstance(item, dict):
            continue
        names[label] = str(item.get("name") or "")
        for span in item.get("spans") or []:
            segments.append({"start": float(span[0]), "end": float(span[1]), "speaker": label})
    if not segments:
        print("❌ Нет размеченных реплик для подбора порога")
        return 1

    wav = ensure_processed()
    cfg.speaker_embeddings_improved = bool(getattr(app_config, "SPEAKER_EMBEDDINGS_IMPROVED", False))
    diar = SpeakerDiarization(cfg)
    print("🧬 Этап 3.5: Эмбеддинги размеченных голосов...", flush=True)
    embeddings = diar.extract_speaker_embeddings(str(wav), segments)
    if not embeddings:
        print("❌ Эмбеддинги не получены")
        return 1
    dim = next(int(len(e)) for e in embeddings.values())
    references = diar._load_reference_embeddings(Path(app_config.REFERENCE_VOICES_DIR), expected_dim=dim)
    items = []
    for label, emb in sorted(embeddings.items()):
        scores = {
            ref: round(1.0 - float(cosine(emb, ref_emb)), 4)
            for ref, ref_emb in references.items()
            if len(ref_emb) == dim
        }
        items.append({"label": label, "name": names.get(label, ""), "scores": scores})
    _write_json(out_dir / CALIBRATION_FILE, {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "embedding_mode": "improved" if cfg.speaker_embeddings_improved else "legacy",
        "references": len(references),
        "items": items,
    })
    print(f"✅ Похожесть посчитана: {len(items)} голосов × {len(references)} эталонов", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
