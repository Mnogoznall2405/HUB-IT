"""Прогон банка видео ВКС только до именования голосов: диаризация -> идентификация -> видео-подсказки (без текста и отчётов).

    python bank_eval.py OUT_DIR video1.mp4 video2.mp4 ...

На каждое видео пишет OUT_DIR/<имя>.json: время этапов, голоса (секунды речи, имя по эталону, расстояние, уверенность,
лучший кандидат), подсказки видео (имя для безымянных, состав комнат, склеенные голоса) и причину, по которой голос не опознан.
Итоговая таблица — OUT_DIR/summary.md. Настройки берутся из боевого .env (окна диаризации, loudnorm и т.д.); ничего не пишет в протоколы.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import config as app_config  # noqa: E402
from modules.main_processor import MainProcessor, ProcessingConfig  # noqa: E402
import video_speaker_hints as hints  # noqa: E402

UNNAMED = re.compile(r"^(?:P\d+_)?SPEAKER_", re.IGNORECASE)


def build_config() -> ProcessingConfig:
    g = lambda name, default=None: getattr(app_config, name, default)  # noqa: E731
    return ProcessingConfig(
        enable_ai_analysis=False, enable_speaker_identification=True, prompt_for_unknown_speakers=False, use_checkpoints=False,
        enable_demucs=False, separator_engine=g('SEPARATOR_ENGINE', 'none'), audio_loudnorm=g('AUDIO_LOUDNORM', False), dead_air_seconds=g('DEAD_AIR_SECONDS', 0),
        enable_diarization=True, enable_alignment=False,
        diarization_audio=g('DIARIZATION_AUDIO', 'processed'), diarization_overlap_assign=g('DIARIZATION_OVERLAP_ASSIGN', False),
        speaker_embeddings_improved=g('SPEAKER_EMBEDDINGS_IMPROVED', False), diarization_exclusive=g('DIARIZATION_EXCLUSIVE', False),
        speaker_recurring=g('SPEAKER_RECURRING', False), speaker_recurring_similarity=g('SPEAKER_RECURRING_SIMILARITY', 0.6),
        strict_similarity_threshold=g('SPEAKER_ID_STRICT', 0.25), moderate_similarity_threshold=g('SPEAKER_ID_MODERATE', 0.35),
        loose_similarity_threshold=g('SPEAKER_ID_LOOSE', 0.45), **app_config.diarization_chunk_options(),
    )


def why_not(details: Dict[str, Any], cfg: ProcessingConfig, hint_name: str, seconds: float) -> str:
    """Короткая причина, по которой голос не опознан автоматически с высокой уверенностью."""
    if details.get('identified') and details.get('confidence') == 'высокая':
        return ''
    distance = details.get('distance')
    if seconds < 20:
        return f'мало речи ({seconds:.0f} с)'
    if distance is None:
        return 'нет эталона/эмбеддинга'
    if distance > cfg.loose_similarity_threshold:
        return f'расстояние {distance:.2f} выше порога {cfg.loose_similarity_threshold} (в базе нет такого голоса или канал сильно отличается)'
    return f'расстояние {distance:.2f}: уверенность «{details.get("confidence")}» (строгий порог {cfg.strict_similarity_threshold})'


def save_samples(audio: Path, turns: List[Dict[str, Any]], voices: List[Dict[str, Any]], target: Path,
                 min_seconds: int = 15, max_seconds: float = 45.0, min_turn: float = 3.0) -> Dict[str, str]:
    """Образец (mp3 до max_seconds из самых длинных реплик) для каждого голоса, не названного с высокой уверенностью."""
    from pydub import AudioSegment

    pending = [v for v in voices if v['seconds'] >= min_seconds and not (v['name'] and v['confidence'] == 'высокая')]
    if not pending:
        return {}
    target.mkdir(parents=True, exist_ok=True)
    wav = AudioSegment.from_file(str(audio))
    saved: Dict[str, str] = {}
    for number, v in enumerate(pending, 1):
        mine = sorted((t for t in turns if t['speaker'] == v['label'] and t['end'] - t['start'] >= min_turn),
                      key=lambda t: t['end'] - t['start'], reverse=True)
        chosen, taken = [], 0.0
        for t in mine:
            if taken >= max_seconds:
                break
            chosen.append(t)
            taken += t['end'] - t['start']
        if not chosen:
            continue
        clip = AudioSegment.empty()
        for t in sorted(chosen, key=lambda t: t['start']):
            clip += wav[int(t['start'] * 1000):int(t['end'] * 1000)] + AudioSegment.silent(200)
        path = target / f"{number:02d}_{v['label']}_{v['seconds']}s.mp3"
        clip.export(str(path), format='mp3')
        saved[v['label']] = str(path)
    return saved


def run_video(video: Path, out_dir: Path) -> Dict[str, Any]:
    base = re.sub(r"[^\w\-]+", "_", video.stem, flags=re.UNICODE)[:60]
    cfg = build_config()
    proc = MainProcessor(cfg)
    times: Dict[str, float] = {}
    t0 = time.time()
    processed = out_dir / f"{base}_processed.wav"
    if not proc.audio_processor.process_audio(str(video), str(processed)):
        raise RuntimeError('аудио не обработано')
    times['audio'] = time.time() - t0
    t = time.time()
    diar_audio = proc._diarization_audio_path(base, str(processed))
    diarize = proc.transcription_processor.perform_diarization(diar_audio)
    times['diarization'] = time.time() - t
    if not diarize:
        raise RuntimeError('диаризация пуста')
    turns = [{'start': float(s['start']), 'end': float(s['end']), 'speaker': str(s['speaker'])} for s in diarize]
    segments = [dict(x, text='') for x in turns]
    t = time.time()
    segs, naming = proc._resolve_speaker_names(str(processed), segments, base,
                                               diarize_turns=getattr(diarize, 'overlap_segments', None) or turns,
                                               blocked_speakers=list((getattr(diarize, 'metadata', {}) or {}).get('review_speakers', [])))
    times['identification'] = time.time() - t
    t = time.time()
    video_result: Dict[str, Any] = {}
    try:
        video_result = hints.analyze(video, [dict(x, speaker=s.get('speaker', x['speaker'])) for x, s in zip(turns, segs)],
                                     faces=bool(getattr(app_config, 'FACE_HINTS', False)),
                                     roster_path=Path(getattr(app_config, 'FACE_ROSTER_PATH', '')) or None)
    except Exception as exc:  # noqa: BLE001
        video_result = {'error': str(exc)}
    times['video_hints'] = time.time() - t
    details = naming.get('identification_details', {})
    seconds: Dict[str, float] = {}
    for x in turns:
        seconds[x['speaker']] = seconds.get(x['speaker'], 0.0) + x['end'] - x['start']
    suggested = video_result.get('suggested', {})
    voices = []
    for label, sec in sorted(seconds.items(), key=lambda kv: -kv[1]):
        d = details.get(label, {})
        voices.append({'label': label, 'seconds': round(sec), 'name': d.get('display_name') if d.get('identified') else None,
                       'candidate': d.get('matched_name') or d.get('display_name'), 'distance': d.get('distance'),
                       'confidence': d.get('confidence'), 'video_suggested': suggested.get(label),
                       'tiles': [(v['tile'][:30], v['share']) for v in (video_result.get('voices', {}).get(label) or [])[:3]],
                       'why_not': why_not(d, cfg, suggested.get(label, ''), sec)})
    samples = save_samples(processed, turns, voices, out_dir / 'samples' / base)
    for v in voices:
        v['sample'] = samples.get(v['label'])
    (out_dir / f"{base}_turns.json").write_text(json.dumps(turns, ensure_ascii=False), encoding='utf-8')
    report = {'video': str(video), 'duration_sec': round(max(x['end'] for x in turns)), 'times_sec': {k: round(v) for k, v in times.items()},
              'total_sec': round(time.time() - t0), 'voices': voices, 'mixed': video_result.get('mixed', []),
              'rooms': {k: v[:2] for k, v in (video_result.get('rooms') or {}).items()}, 'faces': video_result.get('faces')}
    (out_dir / f"{base}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    return report


def summary_line(report: Dict[str, Any]) -> str:
    voices: List[Dict[str, Any]] = report['voices']
    named = sum(v['seconds'] for v in voices if v['name'])
    total = sum(v['seconds'] for v in voices) or 1
    t = report['times_sec']
    return (f"| {Path(report['video']).name[:40]} | {report['duration_sec'] // 60} мин | {report['total_sec'] // 60} мин "
            f"(аудио {t['audio'] // 60}, диар. {t['diarization'] // 60}, имена {t['identification'] // 60}, видео {t['video_hints'] // 60}) "
            f"| {len(voices)} | {100 * named // total} % | {len(report['mixed'])} |")


def main(argv: List[str]) -> int:
    out_dir = Path(argv[0])
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = ["| Видео | Длина | Время (всего) | Голосов | Названо по эталонам | Склеенных |", "|---|---|---|---|---|---|"]
    for name in argv[1:]:
        try:
            report = run_video(Path(name), out_dir)
            lines.append(summary_line(report))
            print(lines[-1], flush=True)
        except Exception as exc:  # noqa: BLE001 - один сбой не останавливает банк
            lines.append(f"| {Path(name).name[:40]} | ошибка: {str(exc)[:80]} | | | | |")
            print(lines[-1], flush=True)
        (out_dir / "summary.md").write_text("\n".join(lines), encoding='utf-8')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
