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
