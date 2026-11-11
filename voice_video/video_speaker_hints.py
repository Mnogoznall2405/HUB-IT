"""«Кто говорит» по видео ВКС (TrueConf): рамка активного говорящего + подпись плитки (OCR).

    python video_speaker_hints.py VIDEO START_S DURATION_S OUT.json [--step 2]

Для каждого кадра находит плитку с оранжевой рамкой (так TrueConf подсвечивает говорящего) и читает подпись
плитки локальным EasyOCR (русская модель; кадры никуда не отправляются). Результат — отрезки времени
«подсвечена плитка X». Это подсказка к диаризации, а не замена ей: плитка может быть человеком, телефонным
участником или комнатой с несколькими людьми.

Чистая логика (find_active_tile, tile_kind, consolidate, associate) покрыта tests/test_voice_video_hints.py.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

Box = Tuple[int, int, int, int]

NAME_BAR = (50, 3, 420, 36)  # область подписи внутри плитки: правее значков микрофона/звезды, у верхнего края


def orange_mask(rgb) -> "Any":
    import numpy as np

    a = np.asarray(rgb).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 140) & (r - b > 55) & (g > b) & (r - g > 20) & (r - g < 90)


def find_active_tile(rgb) -> Optional[Box]:
    """Прямоугольник плитки с оранжевой рамкой или None.

    Рамка — замкнутое тонкое «кольцо» из оранжевых пикселей: после небольшого замыкания это один компонент,
    у которого много площади ограничивающего прямоугольника пусто (в отличие от оранжевых пятен на фото).
    """
    import numpy as np
    from scipy import ndimage

    mask = orange_mask(rgb)
    if mask.sum() < 200:
        return None
    closed = ndimage.binary_closing(mask, structure=np.ones((5, 5), bool))
    labels, _ = ndimage.label(closed)
    best: Optional[Tuple[int, Box]] = None
    for index, sl in enumerate(ndimage.find_objects(labels), start=1):
        height, width = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if width < 150 or height < 80:
            continue
        pixels = int((labels[sl] == index).sum())
        perimeter = 2 * (width + height)
        # кольцо: пикселей порядка периметра × толщина и почти пустая середина; сплошное пятно отбрасывается
        if pixels < 0.5 * perimeter or pixels > 0.2 * width * height:
            continue
        if best is None or pixels > best[0]:
            best = (pixels, (int(sl[1].start), int(sl[0].start), int(sl[1].stop - 1), int(sl[0].stop - 1)))
    return best[1] if best else None


def clean_label(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip(" |_-—.,;:'\"")
    return text


def tile_kind(label: str) -> str:
    """person — «Фамилия Имя Отчество»; room — название места/организации; unknown — пусто."""
    text = clean_label(label)
    if not text:
        return "unknown"
    words = [w for w in re.findall(r"[А-Яа-яЁё-]+", text)]
    looks_person = (len(words) in (2, 3) and all(w[:1].isupper() for w in words)
                    and not re.search(r"\d|ПАО|ООО|АО\b|ул\b|г\.|Санкт|Москва|Магадан|Новая|губа", text, re.IGNORECASE))
    return "person" if looks_person else "room"


def consolidate(samples: Sequence[Dict[str, Any]], step: float, min_len: float = 0.0) -> List[Dict[str, Any]]:
    """Отсчёты [{t, name}] -> отрезки {start, end, name}: подряд идущие одинаковые подписи склеиваются (пропуск до 2 шагов)."""
    spans: List[Dict[str, Any]] = []
    for sample in sorted(samples, key=lambda s: s["t"]):
        name = sample.get("name") or ""
        if not name:
            continue
        if spans and spans[-1]["name"] == name and sample["t"] - spans[-1]["end"] <= 2 * step + 1e-6:
            spans[-1]["end"] = sample["t"] + step
        else:
            spans.append({"start": sample["t"], "end": sample["t"] + step, "name": name})
    return [s for s in spans if s["end"] - s["start"] >= min_len]


def canonical_names(spans: Sequence[Dict[str, Any]], threshold: int = 78) -> Dict[str, str]:
    """Варианты подписи, прочитанные OCR с ошибками, -> одно имя (самое частое по секундам, при равенстве — длинное)."""
    from rapidfuzz import fuzz

    seconds: Counter = Counter()
    for span in spans:
        seconds[span["name"]] += span["end"] - span["start"]
    clusters: List[List[str]] = []
    for name, _ in seconds.most_common():
        for cluster in clusters:
            if fuzz.token_set_ratio(name.lower(), cluster[0].lower()) >= threshold or fuzz.partial_ratio(name.lower(), cluster[0].lower()) >= 92:
                cluster.append(name)
                break
        else:
            clusters.append([name])
    mapping: Dict[str, str] = {}
    for cluster in clusters:
        top = max(cluster, key=lambda n: (seconds[n], len(n)))
        for name in cluster:
            mapping[name] = top
    return mapping


def associate(spans: Sequence[Dict[str, Any]], turns: Sequence[Dict[str, Any]]) -> Dict[str, Counter]:
    """Для каждой подписи плитки — сколько секунд говорил каждый голос/метка (по репликам диаризации или транскрипта)."""
    result: Dict[str, Counter] = defaultdict(Counter)
    for span in spans:
        for turn in turns:
            shared = min(span["end"], float(turn["end"])) - max(span["start"], float(turn["start"]))
            if shared > 0:
                result[span["name"]][str(turn["speaker"])] += shared
    return result


_UNNAMED = re.compile(r"^(?:P\d+_)?SPEAKER_", re.IGNORECASE)
MIXED_MIN_SHARE = 0.12
MIXED_MIN_SECONDS = 30.0


def _surname(name: str) -> str:
    words = re.findall(r"[А-Яа-яЁё-]+", str(name or ""))
    return words[0].lower().replace("ё", "е") if words else ""


_STOP_WORDS = {"улица", "ул", "офис", "пао", "ооо", "г", "город", "проспект", "дом"}


def _city_stems(label: str) -> List[str]:
    """Основы слов названия плитки-комнаты («Магадан» -> «магад», «Санкт-Петербург, ул. Чапаева 15» -> «санкт», «петер»)."""
    words = re.findall(r"[А-Яа-яЁё]{4,}", str(label or ""))
    return [w.lower().replace("ё", "е")[:5] for w in words if w.lower() not in _STOP_WORDS]


def room_people(rooms: Iterable[str], staff_terms: Sequence[Dict[str, Any]], *, limit: int = 5, max_matches: int = 12) -> Dict[str, List[Dict[str, str]]]:
    """Кого можно ожидать за плиткой-комнатой: сотрудники из адресной книги того же города/площадки (по скобке в должности).

    Только подсказка человеку: по площадке берутся её руководители; если и их слишком много (> max_matches, например «Москва»), список не даём.
    Сначала руководители (руководитель проекта, начальник и т.п.), как у людей, которых чаще всего слышно на совещаниях по объекту.
    """
    people = [t for t in staff_terms if t.get("kind") == "person" and t.get("source") == "staff"]
    out: Dict[str, List[Dict[str, str]]] = {}
    for room in rooms:
        stems = _city_stems(room)
        if not stems:
            continue
        matched = []
        for term in people:
            place = re.findall(r"\(([^)]+)\)", str(term.get("expansion") or ""))
            haystack = (" ".join(place) + " " + str(term.get("expansion") or "")).lower().replace("ё", "е")
            if any(stem in haystack for stem in stems):
                matched.append(term)
        leaders = [t for t in matched if re.search(r"руководитель|начальник|директор|главный", str(t.get("expansion") or ""), re.I)]
        matched = leaders or matched          # на площадке сидит много людей: ожидаем прежде всего её руководителей
        if not matched or len(matched) > max_matches:
            continue
        matched.sort(key=lambda t: (-bool(re.search(r"руководитель проекта|начальник участка|начальник объекта", str(t.get("expansion") or ""), re.I)), t["term"]))
        out[room] = [{"person": t["term"], "position": str(t.get("expansion") or "")[:90]} for t in matched[:limit]]
    return out


def summarize_hints(spans: Sequence[Dict[str, Any]], turns: Sequence[Dict[str, Any]], *, min_seconds: float = 20.0,
                    min_share: float = 0.7, staff_terms: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    """Сводка «плитка ↔ голос» для протокола.

    * ``suggested`` — безымянному голосу (SPEAKER_xx) подпись плитки-человека, если ей принадлежит ≥ min_share
      его подсвеченной речи и набралось ≥ min_seconds;
    * ``rooms`` — для каждой плитки-комнаты голоса, звучавшие при её подсветке (состав комнаты);
    * ``mixed`` — один голос подсвечивает нескольких разных людей: диаризация склеила их в одну метку;
    * ``conflicts`` — голос уже назван (по эталону), но его плитка-человек подписана другой фамилией
      (общий аккаунт или ошибка опознания) — на проверку человеком.
    """
    canon = canonical_names(spans)
    spans = [dict(s, name=canon.get(s["name"], s["name"])) for s in spans]
    by_tile = associate(spans, turns)
    by_voice: Dict[str, Counter] = defaultdict(Counter)
    for tile, voices in by_tile.items():
        for voice, seconds in voices.items():
            by_voice[voice][tile] += seconds
    voices_out: Dict[str, Any] = {}
    suggested: Dict[str, str] = {}
    conflicts: List[Dict[str, Any]] = []
    mixed: List[Dict[str, Any]] = []
    for voice, tiles in by_voice.items():
        total = sum(tiles.values())
        ranked = [{"tile": t, "kind": tile_kind(t), "seconds": round(sec, 1), "share": round(sec / total, 2)}
                  for t, sec in tiles.most_common(4)]
        voices_out[voice] = ranked
        # метка голоса, которая подсвечивает нескольких РАЗНЫХ людей-плиток (по ≥25 % и ≥ min_seconds каждый), — это склейка людей
        persons = [r for r in ranked if r["kind"] == "person" and r["share"] >= 0.25 and r["seconds"] >= min_seconds]
        # то же для любых плиток (комната + человек, две комнаты): слабая подсветка ≤ 12 % — запаздывание рамки, не склейка
        distinct = [r for r in ranked if r["share"] >= MIXED_MIN_SHARE and r["seconds"] >= MIXED_MIN_SECONDS]
        if len({_surname(r["tile"])[:5] or r["tile"] for r in persons}) >= 2 or len(distinct) >= 2:
            shown = persons if len({_surname(r["tile"])[:5] for r in persons}) >= 2 else distinct
            mixed.append({"speaker": voice, "tiles": [{"tile": r["tile"], "share": r["share"], "seconds": r["seconds"]} for r in shown]})
        person = next((r for r in ranked if r["kind"] == "person"), None)
        if not person or person["share"] < min_share or person["seconds"] < min_seconds:
            continue
        if _UNNAMED.match(voice):
            suggested[voice] = person["tile"]
        elif _surname(voice) and _surname(person["tile"]) and _surname(voice)[:5] != _surname(person["tile"])[:5]:
            conflicts.append({"speaker": voice, "tile": person["tile"], "share": person["share"], "seconds": person["seconds"]})
    rooms = {}
    for tile, voices in by_tile.items():
        if tile_kind(tile) != "room":
            continue
        total = sum(voices.values()) or 1.0
        rooms[tile] = [{"speaker": v, "seconds": round(sec, 1), "share": round(sec / total, 2)} for v, sec in voices.most_common(5)]
    result = {"suggested": suggested, "conflicts": conflicts, "mixed": mixed, "rooms": rooms, "voices": voices_out}
    if staff_terms:
        result["room_people"] = room_people(rooms, staff_terms)
    return result


def split_mixed_segments(segments: Sequence[Dict[str, Any]], spans: Sequence[Dict[str, Any]], mixed_voices: Iterable[str],
                         *, min_overlap: float = 0.5) -> Dict[int, str]:
    """{индекс сегмента: плитка} для сегментов склеенных голосов (диаризация слила нескольких людей).

    Сегмент относится к плитке, чья подсветка покрывает ≥ min_overlap его длительности; сегменты без подсветки
    (или с неоднозначной) остаются с исходной меткой. Рамка запаздывает на 1–2 с, поэтому порог — половина.
    """
    wanted = set(mixed_voices)
    out: Dict[int, str] = {}
    for index, seg in enumerate(segments):
        if str(seg.get("speaker")) not in wanted:
            continue
        a = float(seg.get("start", seg.get("start_time", 0.0)))
        b = float(seg.get("end", seg.get("end_time", a)))
        if b - a <= 0:
            continue
        cover: Counter = Counter()
        for span in spans:
            overlap = min(b, float(span["end"])) - max(a, float(span["start"]))
            if overlap > 0:
                cover[span["name"]] += overlap
        if not cover:
            continue
        tile, seconds = cover.most_common(1)[0]
        if seconds / (b - a) >= min_overlap and (len(cover) == 1 or seconds > 1.5 * cover.most_common(2)[1][1]):
            out[index] = tile
    return out


def voice_at(turns: Sequence[Dict[str, Any]], moment: float) -> Optional[str]:
    """Название голоса в момент времени (только названные по эталону; SPEAKER_xx не считается)."""
    for turn in turns:
        if float(turn["start"]) <= moment <= float(turn["end"]):
            speaker = str(turn["speaker"])
            return None if _UNNAMED.match(speaker) else speaker
    return None


def summarize_faces(samples: Sequence[Dict[str, Any]], turns: Sequence[Dict[str, Any]], step: float, *,
                    min_seconds: float = 20.0, min_share: float = 0.7) -> Dict[str, Any]:
    """Сводка по лицам: кого видно в подсвеченных плитках и совпадает ли лицо с голосом.

    * ``tiles`` — на каждой плитке (подпись) люди по лицу и доля времени;
    * ``face_voice_conflicts`` — плитка-человек, где лицо опознано как A, а звучит назван B (≥ min_share, ≥ min_seconds):
      аккаунт делили или ошиблись в эталоне голоса. Плитки-комнаты не сравниваем: лицо в кадре не обязано говорить.
    """
    by_tile: Dict[str, Counter] = defaultdict(Counter)
    pairs: Dict[Tuple[str, str], float] = defaultdict(float)
    for sample in samples:
        face, tile = sample.get("face"), sample.get("name")
        if not face or not tile:
            continue
        by_tile[tile][face] += step
        voice = voice_at(turns, sample["t"])
        if voice and tile_kind(tile) == "person":
            pairs[(tile, face)] += step
    tiles = {}
    for tile, people in by_tile.items():
        total = sum(people.values())
        tiles[tile] = [{"person": p, "seconds": round(sec, 1), "share": round(sec / total, 2)} for p, sec in people.most_common(4)]
    conflicts = []
    for (tile, face), seconds in pairs.items():
        votes: Counter = Counter()
        for sample in samples:
            if sample.get("name") == tile and sample.get("face") == face:
                voice = voice_at(turns, sample["t"])
                if voice:
                    votes[voice] += step
        if not votes:
            continue
        voice, top = votes.most_common(1)[0]
        if top / sum(votes.values()) >= min_share and sum(votes.values()) >= min_seconds                 and _surname(voice)[:5] != _surname(face)[:5]:
            conflicts.append({"tile": tile, "face": face, "voice": voice, "seconds": round(sum(votes.values()), 1)})
    return {"tiles": tiles, "face_voice_conflicts": conflicts}


# --- запуск ---------------------------------------------------------------------

def extract_frames(video: Path, start: float, duration: float, step: float, out_dir: Path) -> List[Path]:
    ffmpeg = Path(__file__).resolve().parent / "ffmpeg" / "bin" / "ffmpeg.exe"
    subprocess.run([str(ffmpeg) if ffmpeg.exists() else "ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(duration),
                    "-i", str(video), "-vf", f"fps=1/{step}", "-q:v", "3", str(out_dir / "%05d.jpg")], check=True)
    return sorted(out_dir.glob("*.jpg"))


REREAD_EVERY = 10   # кадров: даже при неподвижной рамке перечитываем подпись (раскладка могла поменяться)


def can_reuse_label(previous: Optional[Dict[str, Any]], box: Box, index: int, tolerance: int = 12) -> bool:
    """Подпись предыдущего кадра можно взять, только если рамка стоит на том же месте в СОСЕДНЕМ кадре.

    Раньше подписи кэшировались по положению рамки на всю запись: положения плиток повторяются у разных людей, и после
    перестановки раскладки на том же месте имя прежнего человека «залипало» (речь Пылаевой записывалась на Миронова).
    Теперь любой разрыв (рамки нет, она ушла на другую плитку, прошло REREAD_EVERY кадров) — OCR заново.
    """
    if not previous or previous.get("index") != index - 1 or index - previous.get("read_index", -999) >= REREAD_EVERY:
        return False
    return all(abs(a - b) <= tolerance for a, b in zip(previous["box"], box))


def read_label(reader, rgb, box: Box) -> Tuple[str, float]:
    """Подпись плитки: самые верхние строки текста внутри рамки (смещение рамки на 10–15 px не страшно)."""
    import numpy as np
    from PIL import Image

    x0, y0, x1, y1 = box
    region = np.asarray(rgb)[y0:min(y1, y0 + 70), x0 + 4:x1]  # значки микрофона/звезды дают мусорные «слова» — они отсеиваются ниже
    crop = Image.fromarray(region)
    crop = crop.resize((crop.width * 3, crop.height * 3))
    parts = reader.readtext(np.asarray(crop), detail=1, paragraph=False)
    lines = []
    for points, text, conf in parts:
        top = min(pt[1] for pt in points) / 3
        if top <= 52 and float(conf) >= 0.3 and re.search(r"[A-Za-zА-Яа-яЁё]{2}", text):
            lines.append((min(pt[0] for pt in points), top, text, float(conf)))
    if not lines:
        return "", 0.0
    first_top = min(l[1] for l in lines)
    lines = [l for l in lines if l[1] <= first_top + 18]  # одна строка подписи (в ней бывает несколько кусков)
    lines.sort()
    return clean_label(" ".join(l[2] for l in lines)), min(l[3] for l in lines)


def run(video: Path, start: float, duration: float, step: float = 2.0, frames_dir: Optional[Path] = None,
        embedder=None, roster=None) -> Dict[str, Any]:
    import easyocr
    import numpy as np
    from PIL import Image

    reader = easyocr.Reader(["ru", "en"], gpu=True, verbose=False)
    temp = None
    if frames_dir is None:
        temp = tempfile.TemporaryDirectory()
        frames_dir = Path(temp.name)
    frames = extract_frames(video, start, duration, step, frames_dir) if not list(frames_dir.glob("*.jpg")) else sorted(frames_dir.glob("*.jpg"))
    samples, previous = [], None
    for index, frame in enumerate(frames):
        rgb = np.asarray(Image.open(frame).convert("RGB"))
        box = find_active_tile(rgb)
        sample = {"t": start + index * step, "box": box, "name": "", "conf": 0.0}
        if box and embedder is not None:
            x0, y0, x1, y1 = box
            vector = embedder.largest_face_vector(rgb[y0 + 40:y1, x0:x1])  # ниже полосы с подписью
            if vector is not None:
                sample["feat"] = vector
                if roster is not None:
                    sample["face"], sample["face_sim"] = roster.identify(vector)
        if box:
            if can_reuse_label(previous, box, index):   # рамка не двигалась — подпись та же, OCR не нужен
                label, read_index = previous["label"], previous["read_index"]
            else:
                label, read_index = read_label(reader, rgb, box), index
            previous = {"index": index, "box": box, "label": label, "read_index": read_index}
            sample["name"], sample["conf"] = label
        else:
            previous = None
        samples.append(sample)
    if temp:
        temp.cleanup()
    spans = consolidate([s for s in samples if s["conf"] >= 0.3 or not s["box"]], step)
    return {"video": str(video), "start": start, "duration": duration, "step": step, "frames": len(frames),
            "detected": sum(1 for s in samples if s["box"]), "samples": samples, "spans": spans}


def speech_windows(turns: Sequence[Dict[str, Any]], duration: float, *, pad: float = 30.0, gap: float = 300.0) -> List[Tuple[float, float]]:
    """Отрезки видео, где есть речь: реплики с запасом ``pad``, склеенные, если пауза между ними не больше ``gap``.

    Запись ВКС бывает на много часов длиннее самой встречи (пустой рабочий стол до и после) — кадры там не нужны.
    Нет реплик (или нет данных) — читаем весь файл, как раньше.
    """
    spans = sorted((max(0.0, float(t["start"]) - pad), min(duration, float(t["end"]) + pad)) for t in turns if float(t["end"]) > float(t["start"]))
    if not spans:
        return [(0.0, duration)]
    merged = [list(spans[0])]
    for start, end in spans[1:]:
        if start - merged[-1][1] <= gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(a, b) for a, b in merged if b > a]


def analyze(video: Path, turns: Sequence[Dict[str, Any]], *, step: float = 2.0, chunk: float = 1800.0,
            duration: Optional[float] = None, faces: bool = False, roster_path: Optional[Path] = None,
            staff_terms: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    """Весь видеофайл кусками по ``chunk`` секунд (кадры во временной папке не копятся) + сводка с голосами.

    ``faces=True`` (FACE_HINTS, биометрия — только после согласования с ИБ): дополнительно опознаёт лица в подсвеченной плитке.
    Эталоны лиц набираются по согласию голоса и плитки (face_roster.enroll_from_agreement) и сохраняются в ``roster_path``
    только как векторы.
    """
    ffprobe = Path(__file__).resolve().parent / "ffmpeg" / "bin" / "ffprobe.exe"
    if duration is None:
        out = subprocess.run([str(ffprobe) if ffprobe.exists() else "ffprobe", "-v", "error", "-show_entries", "format=duration",
                              "-of", "csv=p=0", str(video)], capture_output=True, text=True, check=True).stdout.strip()
        duration = float(out)
    embedder = roster = None
    if faces:
        import face_roster
        embedder = face_roster.FaceEmbedder()
        roster = face_roster.FaceRoster.load(roster_path)
    spans: List[Dict[str, Any]] = []
    face_samples: List[Dict[str, Any]] = []
    detected = frames = 0
    for window_start, window_end in speech_windows(turns, duration):  # тишину и пустой экран между репликами не читаем
        start = window_start
        while start < window_end:
            part = run(video, start, min(chunk, window_end - start), step, embedder=embedder, roster=roster)
            spans.extend(part["spans"])
            face_samples.extend(s for s in part["samples"] if s.get("feat") is not None)
            detected += part["detected"]
            frames += part["frames"]
            start += chunk
    summary = summarize_hints(spans, turns, staff_terms=staff_terms)
    result = {"video": str(video), "frames": frames, "detected": detected, "spans": spans, **summary}
    if faces:
        mapping = canonical_names([{"start": 0, "end": 1, "name": x["name"]} for x in face_samples if x.get("name")])
        enrol = [{"tile": mapping.get(x["name"], x["name"]), "voice": voice_at(turns, x["t"]), "feat": x["feat"]}
                 for x in face_samples if x.get("name") and tile_kind(x["name"]) == "person"]
        added = face_roster.enroll_from_agreement(enrol, roster)
        for x in face_samples:  # после пополнения эталонов опознаём заново — лица, виденные до набора эталонов
            x["face"], x["face_sim"] = roster.identify(x["feat"])
            x["name"] = mapping.get(x["name"], x["name"])
        if added and roster_path:
            roster.save(roster_path)
        result["faces"] = {**summarize_faces(face_samples, turns, step), "enrolled": added, "face_frames": len(face_samples)}
    return result


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Подсказки «кто говорит» по видео ВКС (рамка + OCR подписи)")
    parser.add_argument("video")
    parser.add_argument("start", type=float)
    parser.add_argument("duration", type=float)
    parser.add_argument("out")
    parser.add_argument("--step", type=float, default=2.0)
    args = parser.parse_args(argv)
    result = run(Path(args.video), args.start, args.duration, args.step)
    for sample in result["samples"]:
        sample.pop("feat", None)
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"кадров {result['frames']}, рамка найдена на {result['detected']}, отрезков {len(result['spans'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
