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


class DiarizationChunkError(RuntimeError):
    pass


class DiarizationSegments(list):
    def __init__(self, segments, overlap_segments=None, metadata=None):
        super().__init__(segments)
        self.overlap_segments = list(segments if overlap_segments is None else overlap_segments)
        self.metadata = metadata or {}


REFERENCE_SAMPLES_LIMIT = 10


def reference_sample_files(directory):
    """Сэмплы эталона голоса в естественном порядке (Name, Name_2 … Name_10).

    Сверх лимита остаются первый (исходный) и самые новые: слитый в эталон сэмпл
    должен попадать в эмбеддинг, а не отсекаться по алфавиту.
    """
    import re
    from pathlib import Path

    def natural(path):
        return [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', path.name.lower())]

    directory = Path(directory)
    files = sorted(directory.glob('*.wav'), key=natural) + sorted(directory.glob('*.mp3'), key=natural)
    if len(files) > REFERENCE_SAMPLES_LIMIT:
        files = files[:1] + files[-(REFERENCE_SAMPLES_LIMIT - 1):]
    return files


def wav_duration_seconds(path):
    """Длительность WAV по заголовку; None, если файл не читается как WAV."""
    import wave

    try:
        with wave.open(str(path), 'rb') as handle:
            rate = handle.getframerate()
            return handle.getnframes() / rate if rate else None
    except (OSError, EOFError, wave.Error):
        return None


def diarization_windows(num_samples, sample_rate, chunk_seconds, overlap_seconds):
    import math

    if (sample_rate <= 0 or num_samples < 0 or not math.isfinite(chunk_seconds)
            or not math.isfinite(overlap_seconds) or chunk_seconds <= 0
            or not 0 <= overlap_seconds < chunk_seconds):
        raise ValueError('Некорректная длина или перекрытие окон диаризации')
    size, overlap = round(chunk_seconds * sample_rate), round(overlap_seconds * sample_rate)
    if size <= overlap:
        raise ValueError('Окно диаризации должно быть длиннее перекрытия')
    start = 0
    while start < num_samples:
        end = min(num_samples, start + size)
        keep_start = start + overlap // 2 if start else 0
        keep_end = end - (overlap - overlap // 2) if end < num_samples else end
        yield start, end, keep_start, keep_end
        if end == num_samples:
            break
        start += size - overlap


def _valid_embedding(vector):
    import numpy as np

    if vector is None:
        return None
    arr = np.asarray(vector, dtype=np.float64).ravel()
    norm = float(np.linalg.norm(arr))
    return arr / norm if arr.size and np.isfinite(arr).all() and norm > 0 else None


def _union_duration(turns):
    end, duration = float('-inf'), 0.0
    for turn in sorted(turns, key=lambda t: t['start']):
        duration += max(0.0, turn['end'] - max(end, turn['start']))
        end = max(end, turn['end'])
    return duration


class SpeakerChunkRegistry:
    def __init__(self, similarity=0.80, margin=0.08, min_speech=6.0):
        import math

        if (not all(math.isfinite(v) for v in (similarity, margin, min_speech))
                or not 0 < similarity <= 1 or not 0 <= margin <= 1 or min_speech <= 0):
            raise ValueError('Некорректные пороги сшивки голосов')
        self.similarity, self.margin, self.min_speech = similarity, margin, min_speech
        self.entries, self.decisions = {}, []
        self.quarantined = []
        self.previous, self.previous_end = [], 0.0
        self.dimension = None
        # Пары меток, звучавших в одном окне: pyannote разделил их, значит это разные люди.
        self.distinct = set()

    def _is_rival(self, best, other):
        """Конкурент лучшего прототипа — другой человек, а не дубль того же голоса.

        Дубль — прототип, который никогда не звучал в одном окне с лучшим и не
        «заметно другой» голос (похожесть на лучший не ниже similarity − margin):
        иначе у человека с двумя прототипами каждое окно без якоря плодило бы новую метку.
        Если же вектор окна лежит между двумя заметно разными голосами — это честная
        неоднозначность, метка новая.
        """
        if frozenset((best, other)) in self.distinct:
            return True
        return self._score(self.entries[other]['embedding'], self.entries[best]) < self.similarity - self.margin

    def _anchors(self, turns, offset, end):
        stop = min(end, self.previous_end)
        if stop <= offset:
            return {}
        current = [dict(t, start=t['start'] + offset, end=t['end'] + offset) for t in turns]
        points = sorted({offset, stop} | {
            min(stop, max(offset, value))
            for t in self.previous + current for value in (t['start'], t['end'])
        })
        local_total, global_total, weights = {}, {}, {}
        for start, finish in zip(points, points[1:]):
            mid, duration = (start + finish) / 2, finish - start
            old = {t['speaker'] for t in self.previous if t['start'] <= mid < t['end']}
            new = {t['speaker'] for t in current if t['start'] <= mid < t['end']}
            if len(old) == 1:
                name = next(iter(old))
                global_total[name] = global_total.get(name, 0) + duration
            if len(new) == 1:
                name = next(iter(new))
                local_total[name] = local_total.get(name, 0) + duration
            if len(old) == len(new) == 1:
                pair = next(iter(new)), next(iter(old))
                weights[pair] = weights.get(pair, 0) + duration
        anchors = {}
        for (local, global_label), duration in weights.items():
            purity = min(duration / local_total[local], duration / global_total[global_label])
            if duration >= 2.0 and purity >= .85:
                anchors[local] = (global_label, purity)
        return anchors

    def _score(self, vector, entry):
        if vector is None or entry['embedding'] is None:
            return -1.0
        return min(cosine_similarity(vector, entry['embedding']), cosine_similarity(vector, entry['seed']))

    def assign(self, turns, embeddings, offset, window_end):
        import numpy as np

        labels = sorted({t['speaker'] for t in turns}, key=lambda label: (
            min(t['start'] for t in turns if t['speaker'] == label), label,
        ))
        anchors = self._anchors(turns, offset, window_end)
        proposals, profiles = {}, {}
        for label in labels:
            raw_vector = _valid_embedding(embeddings.get(label))
            if raw_vector is not None:
                if self.dimension is not None and len(raw_vector) != self.dimension:
                    raise DiarizationChunkError('Несовместимая размерность эмбеддингов диаризации')
                self.dimension = len(raw_vector)
            duration = _union_duration(solo_segments(turns, label, turns))
            vector = raw_vector if duration >= self.min_speech else None
            profiles[label] = vector, duration, raw_vector
            candidate, score, reason = None, -1.0, 'insufficient_clean_speech' if vector is None else 'new_voice'
            if label in anchors:
                candidate, purity = anchors[label]
                entry = self.entries[candidate]
                if vector is not None and entry['embedding'] is not None and self._score(vector, entry) < self.similarity - .10:
                    candidate, reason = None, 'boundary_conflict'
                else:
                    score, reason = 1 + purity, 'boundary'
            elif vector is not None:
                scores = sorted(((self._score(vector, entry), key) for key, entry in self.entries.items()), reverse=True)
                if scores and scores[0][0] >= self.similarity:
                    best_key = scores[0][1]
                    rivals = [key for score, key in scores[1:] if scores[0][0] - score < self.margin
                              and self._is_rival(best_key, key)]
                    if rivals:
                        reason = 'ambiguous'
                    else:
                        score, candidate = scores[0]
                        reason = 'embedding'
            proposals[label] = [candidate, score, reason]
        claims = {}
        for label, (candidate, score, _) in proposals.items():
            if candidate is not None:
                claims.setdefault(candidate, []).append((score, label))
        for competitors in claims.values():
            competitors.sort(reverse=True)
            if len(competitors) < 2:
                continue
            winner = competitors[0][1] if competitors[0][0] - competitors[1][0] >= self.margin else None
            for _, label in competitors:
                if label != winner:
                    proposals[label] = [None, -1.0, 'collision']
        mapping = {}
        for label in labels:
            candidate, score, reason = proposals[label]
            vector, duration, raw_vector = profiles[label]
            if reason == 'boundary_conflict':
                vector = None
            weight = min(duration, 30.0) if vector is not None else 0.0
            if candidate is None:
                candidate = f'SPEAKER_{len(self.entries):02d}'
                self.entries[candidate] = {'embedding': vector, 'seed': vector, 'weight': weight}
                if vector is None and raw_vector is not None:
                    # Островок: вектор локального кластера может быть загрязнён
                    # границей окна — в матчинг не берём, но храним для абсорбции
                    self.quarantined.append({'speaker': candidate, 'vector': raw_vector})
            else:
                entry = self.entries[candidate]
                if vector is not None and (entry['embedding'] is None or self._score(vector, entry) >= self.similarity):
                    old_weight = min(entry['weight'], 120.0)
                    entry['embedding'] = l2_normalize(vector * weight + (entry['embedding'] * old_weight if old_weight else 0))
                    entry['seed'] = vector if entry['seed'] is None else entry['seed']
                    entry['weight'] = old_weight + weight
            mapping[label] = candidate
            self.decisions.append({'offset': offset, 'local': label, 'speaker': candidate,
                                   'reason': reason, 'similarity': round(min(score, 1.0), 4)})
        present = sorted(set(mapping.values()))
        self.distinct.update(frozenset((a, b)) for i, a in enumerate(present) for b in present[i + 1:])
        self.previous = [dict(t, speaker=mapping[t['speaker']], start=t['start'] + offset,
                              end=t['end'] + offset) for t in turns]
        self.previous_end = window_end
        return mapping

    def absorb_islands(self):
        """Сливает островки в прототипы при достаточном совпадении вектора.

        Островок — голос, не получивший надёжного матча внутри окна (конфликт
        на границе, мало чистой речи). Его карантинный вектор в матчинге окон
        не участвовал; здесь применяется тот же порог similarity + margin, но
        сам островок исключён из кандидатов (иначе цепочки якорных слияний
        «поглощают» сами себя), а цели разрешаются транзитивно.
        """
        absorbed = {}
        for item in self.quarantined:
            scores = sorted(
                ((self._score(item['vector'], entry), key)
                 for key, entry in self.entries.items()
                 if (entry['embedding'] is not None and key != item['speaker']
                     and key not in absorbed)),
                reverse=True,
            )
            if (scores and scores[0][0] >= self.similarity
                    and (len(scores) == 1 or scores[0][0] - scores[1][0] >= self.margin)):
                absorbed[item['speaker']] = scores[0][1]
                self.decisions.append({'offset': None, 'local': item['speaker'],
                                       'speaker': scores[0][1], 'reason': 'absorbed',
                                       'similarity': round(scores[0][0], 4)})
        resolved = {}
        for island, target in absorbed.items():
            seen = set()
            while target in absorbed and target not in seen:
                seen.add(target)
                target = absorbed[target]
            if target != island:
                resolved[island] = target
        return resolved

    def merge_duplicates(self, speech, overlap, vectors=None):
        """Склеивает метки одного человека, разорванные между окнами.

        Дубль — пара голосов, чьи прототипы не «заметно разные» (косинус не ниже
        similarity − margin), которые ни разу не звучали в одном окне и почти не
        перекрываются по времени (человек не говорит поверх себя). Группы
        сравниваются по общему центру, поэтому цепочка A~B, B~C при A≁C не склеится.
        ``speech`` — {метка: секунд речи}, ``overlap(a, b)`` — секунд одновременной речи.
        ``vectors`` — {метка: вектор}, пересчитанный по чистым репликам всей записи: он
        надёжнее оконных прототипов (у малоговорящих те шумят) и, если задан, заменяет их.
        Возвращает {метка: оставшаяся метка}; остаётся метка с большей речью.
        """
        if vectors is not None:
            vectors = {key: _valid_embedding(vector) for key, vector in vectors.items()}
        # Метки, помеченные на ручную проверку (ambiguous/boundary_conflict), не склеиваем:
        # это была бы та самая принудительная склейка, которой избегает матчинг окон.
        flagged = {d['speaker'] for d in self.decisions if d['reason'] in ('ambiguous', 'boundary_conflict')}
        if vectors is None:
            vectors = {key: entry['embedding'] for key, entry in self.entries.items()}
        groups = {key: {key} for key, vector in vectors.items()
                  if vector is not None and speech.get(key, 0) > 0 and key not in flagged}
        centers = {key: vectors[key] for key in groups}
        weights = {key: speech[key] for key in groups}
        threshold = self.similarity - self.margin
        while True:
            best = None
            for a in sorted(groups):
                for b in sorted(groups):
                    if b <= a:
                        continue
                    sim = cosine_similarity(centers[a], centers[b])
                    if sim < threshold or (best is not None and sim <= best[0]):
                        continue
                    if any(frozenset((x, y)) in self.distinct for x in groups[a] for y in groups[b]):
                        continue
                    shared = sum(overlap(x, y) for x in groups[a] for y in groups[b])
                    if shared > 0.05 * min(weights[a], weights[b]):
                        continue
                    best = (sim, a, b)
            if best is None:
                break
            sim, a, b = best
            keeper, other = (a, b) if (weights[a], b) >= (weights[b], a) else (b, a)
            centers[keeper] = l2_normalize(centers[keeper] * weights[keeper] + centers[other] * weights[other])
            weights[keeper] += weights.pop(other)
            groups[keeper] |= groups.pop(other)
            del centers[other]
            self.decisions.append({'offset': None, 'local': other, 'speaker': keeper,
                                   'reason': 'merged', 'similarity': round(sim, 4)})
        return {member: keeper for keeper, members in groups.items() for member in members if member != keeper}


def _validate_chunk_payload(payload, duration):
    import math

    if not isinstance(payload, dict) or not isinstance(payload.get('embeddings'), dict):
        raise DiarizationChunkError('Модель не вернула эмбеддинги спикеров окна')
    result = {'embeddings': {str(label): (vector.tolist() if vector is not None else None)
                            for label, value in payload['embeddings'].items()
                            for vector in [_valid_embedding(value)]}}
    for key in ('segments', 'overlap_segments'):
        if not isinstance(payload.get(key), list):
            raise DiarizationChunkError('Модель не вернула разметку окна')
        result[key] = []
        for turn in payload[key]:
            start, end, label = float(turn['start']), float(turn['end']), str(turn['speaker'])
            if not math.isfinite(start) or not math.isfinite(end) or end <= start or not label:
                raise DiarizationChunkError('Некорректная реплика окна диаризации')
            start, end = max(0.0, start), min(duration, end)
            if end > start:
                result[key].append({'start': start, 'end': end, 'speaker': label})
    regular = {t['speaker'] for t in result['overlap_segments']}
    if any(t['speaker'] not in regular for t in result['segments']):
        raise DiarizationChunkError('Обычная разметка окна не содержит спикеров exclusive-разметки')
    return result


def _intervals_overlap(first, second):
    """Секунд пересечения двух отсортированных списков непересекающихся интервалов."""
    i = j = 0
    total = 0.0
    while i < len(first) and j < len(second):
        total += max(0.0, min(first[i][1], second[j][1]) - max(first[i][0], second[j][0]))
        if first[i][1] <= second[j][1]:
            i += 1
        else:
            j += 1
    return total


def _merge_diarization_turns(turns):
    by_speaker = {}
    for turn in sorted(turns, key=lambda t: (t['speaker'], t['start'], t['end'])):
        group = by_speaker.setdefault(turn['speaker'], [])
        if group and turn['start'] <= group[-1]['end'] + 1e-6:
            group[-1]['end'] = max(group[-1]['end'], turn['end'])
        else:
            group.append(dict(turn))
    return sorted((t for group in by_speaker.values() for t in group), key=lambda t: (t['start'], t['end'], t['speaker']))


def run_chunked_diarization(audio, diarize_window, *, sample_rate=16000, chunk_seconds=900,
                            overlap_seconds=30, local_max_speakers=20, similarity=.80, margin=.08,
                            min_speech=6.0, cache_prefix=None, cache_identity=None, progress=None,
                            label_embedder=None):
    import hashlib
    import json
    import time
    from pathlib import Path
    import numpy as np

    audio = np.asarray(audio)
    if audio.ndim != 1 or local_max_speakers < 1:
        raise ValueError('Нужен моно-звук и положительный предел спикеров окна')
    windows = list(diarization_windows(len(audio), sample_rate, chunk_seconds, overlap_seconds))
    registry = SpeakerChunkRegistry(similarity, margin, min_speech)
    selected, ordinary, details = [], [], []
    policy = {'version': 1, 'sample_rate': sample_rate, 'chunk_seconds': chunk_seconds,
              'overlap_seconds': overlap_seconds, 'local_max_speakers': local_max_speakers,
              'similarity': similarity, 'margin': margin, 'min_speech': min_speech,
              'identity': cache_identity}
    key = None
    if cache_prefix is not None:
        policy['audio_hash'] = hashlib.sha256(np.ascontiguousarray(audio)).hexdigest()
        key = hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest()
    for idx, (start, end, keep_start, keep_end) in enumerate(windows):
        began, cached, payload = time.perf_counter(), False, None
        path = Path(f'{cache_prefix}_{idx:04d}.json') if cache_prefix is not None else None
        if path is not None and path.exists():
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                if data.get('key') == key and data.get('samples') == [start, end]:
                    payload = _validate_chunk_payload(data['payload'], (end - start) / sample_rate)
                    cached = True
            except (OSError, ValueError, KeyError, TypeError, DiarizationChunkError):
                payload = None
        try:
            if payload is None:
                payload = _validate_chunk_payload(diarize_window(
                    audio[start:end], num_speakers=None, min_speakers=1, max_speakers=local_max_speakers,
                ), (end - start) / sample_rate)
                if path is not None:
                    pending = path.with_suffix('.json.part')
                    pending.write_text(json.dumps({'key': key, 'samples': [start, end], 'payload': payload},
                                                  allow_nan=False), encoding='utf-8')
                    pending.replace(path)
            mapping = registry.assign(payload['overlap_segments'], payload['embeddings'],
                                      start / sample_rate, end / sample_rate)
            for source, target in ((payload['segments'], selected), (payload['overlap_segments'], ordinary)):
                for turn in source:
                    left = max(keep_start / sample_rate, start / sample_rate + turn['start'])
                    right = min(keep_end / sample_rate, start / sample_rate + turn['end'])
                    if right > left:
                        target.append({'start': left, 'end': right, 'speaker': mapping[turn['speaker']]})
        except Exception as exc:
            raise DiarizationChunkError(f'Ошибка диаризации окна {idx + 1}/{len(windows)}: {exc}') from exc
        details.append({'index': idx, 'start': start / sample_rate, 'end': end / sample_rate,
                        'cached': cached, 'seconds': round(time.perf_counter() - began, 3),
                        'saturated': len(mapping) >= local_max_speakers})
        if progress is not None:
            progress(idx + 1, len(windows), details[-1])
    absorbed = registry.absorb_islands()
    if absorbed:
        for source in (selected, ordinary):
            for turn in source:
                turn['speaker'] = absorbed.get(turn['speaker'], turn['speaker'])
    ordinary = _merge_diarization_turns(ordinary)
    spans = {}
    for turn in ordinary:
        spans.setdefault(turn['speaker'], []).append((turn['start'], turn['end']))
    speech = {label: sum(end - start for start, end in items) for label, items in spans.items()}
    final_vectors, vectors_source = None, 'prototype'
    if label_embedder is not None:
        try:
            final_vectors = label_embedder(_merge_diarization_turns(selected), ordinary)
            vectors_source = 'final'
        except Exception:  # пересчёт — улучшение слияния, не повод ронять диаризацию
            final_vectors = None
    merged = registry.merge_duplicates(speech, lambda a, b: _intervals_overlap(spans.get(a, []), spans.get(b, [])),
                                       vectors=final_vectors)
    if merged:
        for source in (selected, ordinary):
            for turn in source:
                turn['speaker'] = merged.get(turn['speaker'], turn['speaker'])
    used = {t['speaker'] for t in ordinary} | {t['speaker'] for t in selected}
    return DiarizationSegments(_merge_diarization_turns(selected), _merge_diarization_turns(ordinary), {
        'mode': 'chunked', 'speakers_count': len(used), 'windows': details,
        'decisions': registry.decisions, 'absorbed': absorbed, 'merged': merged,
        'merge_vectors': vectors_source,
        'review_speakers': sorted(
            {d['speaker'] for d in registry.decisions
             if d['reason'] in ('boundary_conflict', 'ambiguous')} - set(absorbed) - set(merged)),
    })


def diarization_cache_policy(config):
    import hashlib
    import json

    size = getattr(config, 'diarization_chunk_seconds', 0)
    if not size:
        return None
    names = ('diarization_num_speakers', 'diarization_min_speakers', 'diarization_max_speakers',
             'diarization_clustering_threshold', 'diarization_min_duration_off', 'diarization_audio',
             'diarization_exclusive', 'diarization_overlap_assign', 'speaker_embeddings_improved',
             'diarization_chunk_seconds', 'diarization_chunk_threshold_seconds',
             'diarization_chunk_overlap_seconds', 'diarization_chunk_max_speakers',
             'diarization_stitch_similarity', 'diarization_stitch_margin', 'diarization_stitch_min_speech')
    payload = {'version': 1, **{name: getattr(config, name, None) for name in names}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
