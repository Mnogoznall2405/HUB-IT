"""Лица сотрудников из записей ВКС: вырезать -> сгруппировать по людям -> страница для подписи имён.

    python face_cluster.py scan OUT_DIR --clip "video.mp4,6600,1200" --clip "other.mp4"   # (старт, длительность необязательны)
    # откройте OUT_DIR/review.html: впишите ФИО, уберите лишние лица/кластеры, нажмите «Сохранить» -> assign.json
    python face_enroll.py apply OUT_DIR assign.json                                       # в эталоны уходят только векторы

Биометрические данные: превью лиц нужны только на время подписи (``face_enroll.py purge OUT_DIR`` их удаляет).
Чистая логика (cluster_vectors) покрыта tests/test_voice_face_cluster.py.
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
THUMB = 96
SHOWN_PER_CLUSTER = 24
MIN_CLUSTER_FACES = 3


def cluster_vectors(vectors, threshold: float = 0.45, merge_threshold: float = 0.55) -> List[List[int]]:
    """Группы индексов: один кластер — один человек. Жадно к ближайшему центру (>= threshold), затем слияние близких центров."""
    import numpy as np

    units = [np.asarray(v, dtype=np.float64) / (np.linalg.norm(v) or 1.0) for v in vectors]

    def center_of(indices):
        mean = np.mean([units[i] for i in indices], axis=0)
        return mean / (np.linalg.norm(mean) or 1.0)

    centers: List[Any] = []
    members: List[List[int]] = []
    for index, vec in enumerate(units):
        best, best_sim = -1, -1.0
        for c, center in enumerate(centers):
            sim = float(vec @ center)
            if sim > best_sim:
                best, best_sim = c, sim
        if best >= 0 and best_sim >= threshold:
            members[best].append(index)
            centers[best] = center_of(members[best])
        else:
            centers.append(vec)
            members.append([index])
    merged = True
    while merged:
        merged = False
        for a in range(len(centers)):
            for b in range(a + 1, len(centers)):
                if float(centers[a] @ centers[b]) >= merge_threshold:
                    members[a] += members[b]
                    centers[a] = center_of(members[a])
                    del centers[b], members[b]
                    merged = True
                    break
            if merged:
                break
    return sorted((sorted(m) for m in members), key=len, reverse=True)


def _duration(video: Path) -> float:
    ffprobe = HERE / "ffmpeg" / "bin" / "ffprobe.exe"
    out = subprocess.run([str(ffprobe) if ffprobe.exists() else "ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(video)], capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def parse_clip(spec: str):
    """'путь' или 'путь,старт,длительность' (секунды)."""
    parts = spec.rsplit(",", 2)
    if len(parts) == 3 and parts[1].replace(".", "").isdigit() and parts[2].replace(".", "").isdigit():
        return Path(parts[0]), float(parts[1]), float(parts[2])
    return Path(spec), 0.0, None


def scan(clips: Sequence[str], out_dir: Path, step: float = 4.0, min_size: int = 28) -> Dict[str, Any]:
    import cv2
    import numpy as np

    sys.path.insert(0, str(HERE))
    import face_roster
    import video_speaker_hints as hints

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "thumbs").mkdir(exist_ok=True)
    embedder = face_roster.FaceEmbedder()
    faces: List[Dict[str, Any]] = []
    vectors: List[Any] = []
    for spec in clips:
        video, start, duration = parse_clip(spec)
        duration = duration or max(0.0, _duration(video) - start)
        position = start
        while position < start + duration:  # кусками по 10 минут: кадры не копятся на диске
            length = min(600.0, start + duration - position)
            with tempfile.TemporaryDirectory() as tmp:
                frames = hints.extract_frames(video, position, length, step, Path(tmp))
                for index, frame in enumerate(frames):
                    bgr = cv2.imread(str(frame))
                    if bgr is None:
                        continue
                    embedder.detector.setInputSize((bgr.shape[1], bgr.shape[0]))
                    _, found = embedder.detector.detect(bgr)
                    for row in (found if found is not None else []):
                        if row[2] < min_size or row[3] < min_size:
                            continue
                        vec = face_roster._unit(embedder.recognizer.feature(embedder.recognizer.alignCrop(bgr, row)))
                        x, y, w, h = [int(max(0, v)) for v in row[:4]]
                        pad = int(0.25 * max(w, h))
                        crop = bgr[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad]
                        if crop.size == 0:
                            continue
                        fid = len(faces)
                        cv2.imwrite(str(out_dir / "thumbs" / f"{fid}.jpg"), cv2.resize(crop, (THUMB, THUMB)),
                                    [cv2.IMWRITE_JPEG_QUALITY, 80])
                        faces.append({"id": fid, "video": video.name, "t": round(position + index * step, 1), "size": int(min(w, h))})
                        vectors.append(vec)
            position += length
    groups = cluster_vectors(vectors) if vectors else []
    clusters = [{"id": c, "faces": g} for c, g in enumerate(groups) if len(g) >= MIN_CLUSTER_FACES]
    np.save(out_dir / "vectors.npy", np.asarray(vectors, dtype=np.float32) if vectors else np.zeros((0, 128), dtype=np.float32))
    data = {"faces": faces, "clusters": clusters}
    (out_dir / "faces.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (out_dir / "review.html").write_text(render_review(data), encoding="utf-8")
    return {"faces": len(faces), "clusters": len(clusters), "dropped_small": len(groups) - len(clusters)}


def clips_around_speech(clips: Sequence[str], segments_path: Path) -> List[str]:
    """Клипы только вокруг реплик (пустые часы записи не читаем): те же окна, что у видео-подсказок."""
    sys.path.insert(0, str(HERE))
    import video_speaker_hints as hints

    turns = [{"start": float(t["start"]), "end": float(t["end"]), "speaker": ""}
             for t in json.loads(Path(segments_path).read_text(encoding="utf-8")) if t.get("end") is not None]
    out: List[str] = []
    for spec in clips:
        video, start, duration = parse_clip(spec)
        total = duration or max(0.0, _duration(video) - start)
        out += [f"{video},{start + begin},{end - begin}" for begin, end in hints.speech_windows(turns, total)]
    return out


PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Лица из ВКС</title>
<style>body{font:15px system-ui,sans-serif;margin:20px;background:#f4f5f7;color:#222}.card{background:#fff;border-radius:10px;padding:14px;margin:12px 0;box-shadow:0 1px 3px #0002}
.thumbs img{width:72px;height:72px;object-fit:cover;margin:2px;border-radius:6px;cursor:pointer;border:3px solid transparent}.thumbs img.x{opacity:.25;border-color:#d33}
.row{margin-top:8px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.name{width:340px;padding:6px}.meta{color:#666;margin-bottom:6px}
button{padding:10px 18px;font-size:15px;cursor:pointer}</style></head><body>
<h2>Лица из записей ВКС</h2><p>Впишите ФИО для каждого человека. Клик по лицу — оно лишнее (другой человек, не лицо). Пустое имя — кластер пропускается;
галочка «удалить» — это не человек. Лица — биометрия: после загрузки удалите превью командой <code>face_enroll.py purge</code>.</p>
__CARDS__
<button id="save">Сохранить assign.json</button>
<script>
document.querySelectorAll('.thumbs img').forEach(i=>i.onclick=()=>i.classList.toggle('x'));
document.getElementById('save').onclick=()=>{const out={};
document.querySelectorAll('.card').forEach(c=>{out[c.dataset.cluster]={name:c.querySelector('.name').value.trim(),delete:c.querySelector('.del').checked,
excluded:[...c.querySelectorAll('img.x')].map(i=>+i.dataset.face)}});
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:'application/json'}));a.download='assign.json';a.click();};
</script></body></html>"""


def render_review(data: Dict[str, Any]) -> str:
    cards = []
    for cluster in data["clusters"]:
        ids = cluster["faces"]
        stride = max(1, len(ids) // SHOWN_PER_CLUSTER)
        thumbs = "".join(f'<img src="thumbs/{i}.jpg" data-face="{i}" title="клик — убрать как лишнее">' for i in ids[::stride][:SHOWN_PER_CLUSTER])
        first = data["faces"][ids[0]]
        cards.append(
            f'<section class="card" data-cluster="{cluster["id"]}"><div class="meta">Кластер {cluster["id"] + 1}: {len(ids)} лиц, '
            f'{html.escape(first["video"])}, с {int(first["t"] // 60)} мин</div><div class="thumbs">{thumbs}</div>'
            f'<div class="row"><input placeholder="ФИО (пусто — пропустить)" class="name">'
            f'<label><input type="checkbox" class="del"> удалить кластер (не человек / случайные лица)</label></div></section>')
    return PAGE.replace("__CARDS__", "".join(cards) or "<p>Лиц не найдено.</p>")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Лица из ВКС -> кластеры -> страница подписи")
    sub = parser.add_subparsers(dest="cmd", required=True)
    scan_p = sub.add_parser("scan")
    scan_p.add_argument("out_dir")
    scan_p.add_argument("--clip", action="append", required=True, metavar="ВИДЕО[,старт,длительность]")
    scan_p.add_argument("--step", type=float, default=4.0)
    scan_p.add_argument("--segments", metavar="JSON", help="реплики [{start,end}]: смотреть видео только вокруг речи")
    args = parser.parse_args(argv)
    clips = clips_around_speech(args.clip, Path(args.segments)) if args.segments else args.clip
    print(json.dumps(scan(clips, Path(args.out_dir), args.step), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
