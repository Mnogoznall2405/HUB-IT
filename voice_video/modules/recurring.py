"""Реестр повторяющихся неизвестных голосов между встречами (SPEAKER_RECURRING).

Неизвестный голос, похожий на голос из другой встречи, получает общий id
(R001, …): в карточке протокола видно «встречался ещё в N записях», и такого
участника достаточно назвать и записать в эталоны один раз.

Файл: voice_video/data/recurring_voices.json (атомарная запись). Пишет только
worker (последовательно), поэтому блокировок между процессами не нужно.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List

from .speaker_utils import register_recurring

logger = logging.getLogger(__name__)

MAX_ENTRIES = 2000


def registry_path(project_root: Path) -> Path:
    return Path(project_root) / "data" / "recurring_voices.json"


def load_registry(path: Path) -> List[Dict]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as e:
        logger.warning(f"⚠️ Реестр повторяющихся голосов не прочитан ({e}) — начинаю новый")
        return []
    entries = data.get("voices") if isinstance(data, dict) else None
    return entries if isinstance(entries, list) else []


def save_registry(path: Path, entries: List[Dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"voices": entries[-MAX_ENTRIES:]}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def register_meeting_voices(path: Path, base: str, embeddings: Dict[str, object],
                            threshold: float) -> Dict[str, Dict]:
    """Отмечает неизвестные голоса встречи; возвращает {метка: {id, meetings, count}}."""
    if not embeddings:
        return {}
    entries = load_registry(path)
    result: Dict[str, Dict] = {}
    for label, embedding in sorted(embeddings.items()):
        if embedding is None:
            continue
        entry = register_recurring(entries, embedding, base, label, threshold)
        meetings = sorted({o.get("base") for o in entry.get("occurrences") or []} - {base})
        result[label] = {"id": entry["id"], "meetings": meetings, "count": len(meetings) + 1}
    save_registry(path, entries)
    return result
