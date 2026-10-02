"""Чистые функции назначения спикеров и выбора реплик для эмбеддингов.

Без torch/pyannote — покрыты тестами (tests/test_voice_speaker_utils.py).
"""

import bisect
from typing import Dict, List, Optional, Sequence, Tuple


class TurnIndex:
    """Реплики диаризации, отсортированные по началу, с поиском по пересечению.

    Заменяет индекс «каждые 100 мс -> спикер», в котором при одновременной речи
    побеждал спикер, записанный последним (фактически случайный).
    """

    def __init__(self, turns: Sequence[Dict]):
        clean = []
        for t in turns or []:
            try:
                start, end = float(t["start"]), float(t["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if end > start:
                clean.append((start, end, str(t.get("speaker") or "SPEAKER_UNKNOWN")))
        clean.sort()
        self.turns: List[Tuple[float, float, str]] = clean
        self.starts = [t[0] for t in clean]
        # max(end) по префиксу: длинная реплика с перебивками внутри начинается
        # раньше многих соседей — по префиксному максимуму видно, где остановить поиск.
        self.prefix_max_end: List[float] = []
        running = float("-inf")
        for _, end, _ in clean:
            running = max(running, end)
            self.prefix_max_end.append(running)

    def __bool__(self) -> bool:
        return bool(self.turns)

    def _candidates(self, start: float, end: float, slack: float = 0.0):
        """Реплики, начавшиеся до end и заканчивающиеся после start - slack."""
        j = bisect.bisect_left(self.starts, end) - 1
        while j >= 0 and self.prefix_max_end[j] > start - slack:
            turn = self.turns[j]
            if turn[1] > start - slack:
                yield turn
            j -= 1

    def speaker_for_span(self, start: float, end: float, snap: float = 0.3) -> Optional[str]:
        """Спикер с наибольшим перекрытием с [start, end].

        При равенстве — у кого реплика короче (перебивающий говорящий), затем по имени
        (детерминированно). Нет перекрытия — ближайшая реплика не дальше ``snap`` с.
        """
        if end < start:
            start, end = end, start
        overlap: Dict[str, float] = {}
        shortest: Dict[str, float] = {}
        for t_start, t_end, spk in self._candidates(start, end):
            ov = min(end, t_end) - max(start, t_start)
            if ov > 0 or (start == end and t_start <= start < t_end):
                overlap[spk] = overlap.get(spk, 0.0) + max(ov, 0.0)
                shortest[spk] = min(shortest.get(spk, float("inf")), t_end - t_start)
        if overlap:
            return min(overlap, key=lambda s: (-overlap[s], shortest[s], s))

        best, best_dist = None, snap
        nearby = list(self._candidates(start, end, slack=snap))
        idx = bisect.bisect_left(self.starts, end)
        if idx < len(self.turns):
            nearby.append(self.turns[idx])  # первая реплика после отрезка
        for t_start, t_end, spk in nearby:
            dist = t_start - end if end < t_start else start - t_end
            if 0 <= dist <= best_dist and (best is None or dist < best_dist or spk < best):
                best, best_dist = spk, dist
        return best


def assign_words_by_overlap(words: Sequence[Dict], index: TurnIndex, fallback: str) -> List[str]:
    """Спикер для каждого слова; без пересечений — предыдущее слово или fallback."""
    out: List[str] = []
    last = None
    for w in words:
        spk = index.speaker_for_span(float(w["start"]), float(w["end"])) or last or fallback
        out.append(spk)
        last = spk
    return out


def pick_embedding_spans(
    segments: Sequence[Dict],
    *,
    max_spans: int = 15,
    min_duration: float = 2.0,
    max_duration: float = 8.0,
) -> List[Tuple[float, float]]:
    """Отрезки для эмбеддинга спикера: самые длинные реплики, середина не длиннее max_duration.

    Края реплики чаще захватывают соседа (перебивка, неточная граница диаризации),
    поэтому берётся центральная часть.
    """
    spans = []
    for seg in segments or []:
        start = seg.get("start", seg.get("start_time"))
        end = seg.get("end", seg.get("end_time"))
        try:
            start, end = float(start), float(end)
        except (TypeError, ValueError):
            continue
        if end - start >= min_duration:
            spans.append((start, end))
    spans.sort(key=lambda s: s[1] - s[0], reverse=True)
    out = []
    for start, end in spans[:max_spans]:
        length = end - start
        if length > max_duration:
            mid = (start + end) / 2
            start, end = mid - max_duration / 2, mid + max_duration / 2
        out.append((round(start, 3), round(end, 3)))
    return out


def l2_normalize(vector):
    """Нормировка вектора (list/ndarray) к единичной длине; нулевой — как есть."""
    import numpy as np

    arr = np.asarray(vector, dtype=np.float64).ravel()
    norm = float(np.linalg.norm(arr))
    return arr / norm if norm > 0 else arr


def mean_normalized(vectors):
    """Среднее нормированных векторов, снова нормированное (устойчиво к громкости/длине)."""
    import numpy as np

    vecs = [l2_normalize(v) for v in vectors if v is not None]
    if not vecs:
        return None
    return l2_normalize(np.mean(vecs, axis=0))


# --- «Чистые» реплики для профиля голоса ------------------------------------

def subtract_intervals(span: Tuple[float, float], others: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Части отрезка span, не пересекающиеся ни с одним из others."""
    pieces = [span]
    for o_start, o_end in sorted(others):
        nxt = []
        for p_start, p_end in pieces:
            if o_end <= p_start or o_start >= p_end:
                nxt.append((p_start, p_end))
                continue
            if o_start > p_start:
                nxt.append((p_start, o_start))
            if o_end < p_end:
                nxt.append((o_end, p_end))
        pieces = nxt
    return pieces


def solo_segments(segments: Sequence[Dict], speaker: str, turns: Optional[Sequence[Dict]],
                  pad: float = 0.2) -> List[Dict]:
    """Реплики спикера без мест, где по диаризации говорит кто-то ещё (±pad).

    Без turns (resume по сохранённому транскрипту) — реплики как есть.
    """
    own = [s for s in segments or [] if s.get("speaker") == speaker]
    if not turns:
        return own
    index = TurnIndex([t for t in turns if str(t.get("speaker")) != speaker])
    out = []
    for seg in own:
        start = float(seg.get("start", seg.get("start_time", 0)) or 0)
        end = float(seg.get("end", seg.get("end_time", 0)) or 0)
        if end <= start:
            continue
        others = [(s - pad, e + pad) for s, e, _ in index._candidates(start, end, slack=pad)]
        for p_start, p_end in subtract_intervals((start, end), others):
            out.append({"start": p_start, "end": p_end, "speaker": speaker})
    return out


# --- Повторяющиеся неизвестные голоса между встречами ------------------------

def cosine_similarity(a, b) -> float:
    import numpy as np

    va, vb = l2_normalize(a), l2_normalize(b)
    if va.shape != vb.shape or not va.any() or not vb.any():
        return -1.0
    return float(np.dot(va, vb))


def match_recurring(entries: Sequence[Dict], embedding, threshold: float) -> Tuple[Optional[Dict], float]:
    """Ближайший повторяющийся голос с похожестью ≥ threshold (размерность должна совпадать)."""
    best, best_sim = None, -1.0
    for entry in entries or []:
        sim = cosine_similarity(entry.get("embedding") or [], embedding)
        if sim > best_sim:
            best, best_sim = entry, sim
    if best is not None and best_sim >= threshold:
        return best, best_sim
    return None, best_sim


def register_recurring(entries: List[Dict], embedding, base: str, label: str, threshold: float,
                       max_occurrences: int = 200) -> Dict:
    """Находит или заводит повторяющийся голос и отмечает встречу. Мутирует entries.

    Центр голоса — нормированное среднее с весом по числу встреч, чтобы один
    шумный прогон не сдвигал его сильно. Повтор той же (встреча, метка) не
    увеличивает счётчик (resume, повторная обработка).
    """
    import numpy as np

    vec = l2_normalize(embedding)
    entry, _ = match_recurring(entries, vec, threshold)
    if entry is None:
        next_num = 1 + max((int(str(e.get("id", "R0"))[1:] or 0) for e in entries), default=0)
        entry = {"id": f"R{next_num:03d}", "embedding": vec.tolist(), "occurrences": []}
        entries.append(entry)
    occ = entry.setdefault("occurrences", [])
    if not any(o.get("base") == base and o.get("label") == label for o in occ):
        n = len({o.get("base") for o in occ})
        if n:
            old = np.asarray(entry["embedding"], dtype=np.float64)
            entry["embedding"] = l2_normalize(old * min(n, 20) + vec).tolist()
        occ.append({"base": base, "label": label})
        del occ[:-max_occurrences]
    return entry
