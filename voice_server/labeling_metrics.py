"""Diarization error rate (DER) between a reference labeling and a hypothesis.

Pure Python (no numpy/pyannote in the hub process). Follows the NIST md-eval
convention used by ``pyannote.metrics``:

* reference boundaries get a forgiveness collar (default 0.25 s each side);
* hypothesis speakers are mapped one-to-one to reference speakers so that the
  total co-occurrence time is maximal (Hungarian algorithm);
* overlapped speech counts every speaker: per elementary interval
  ``miss = max(0, Nref - Nhyp)``, ``false alarm = max(0, Nhyp - Nref)``,
  ``confusion = min(Nref, Nhyp) - Ncorrect``; DER = (miss + fa + conf) / ref speech.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_COLLAR = 0.25

Segment = Tuple[float, float, str]


def _clean(segments: Iterable[Dict[str, Any]]) -> List[Segment]:
    out: List[Segment] = []
    for seg in segments or []:
        try:
            start, end = float(seg["start"]), float(seg["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end > start:
            out.append((start, end, str(seg.get("speaker") or "UNKNOWN")))
    return out


def _merge_zones(zones: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    merged: List[Tuple[float, float]] = []
    for start, end in sorted(zones):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _elementary_intervals(
    ref: List[Segment], hyp: List[Segment], collar: float
) -> List[Tuple[float, frozenset, frozenset]]:
    """(duration, active ref speakers, active hyp speakers) outside collar zones."""
    zones = _merge_zones(
        [(t - collar, t + collar) for s, e, _ in ref for t in (s, e)] if collar > 0 else []
    )
    # Events: (time, order, kind, speaker, delta); order keeps ends before starts.
    events = []
    for kind, segs in (("r", ref), ("h", hyp)):
        for s, e, spk in segs:
            events.append((s, 1, kind, spk, 1))
            events.append((e, 0, kind, spk, -1))
    for s, e in zones:
        events.append((s, 1, "c", "", 1))
        events.append((e, 0, "c", "", -1))
    events.sort(key=lambda ev: (ev[0], ev[1]))

    active = {"r": {}, "h": {}}
    in_collar = 0
    out: List[Tuple[float, frozenset, frozenset]] = []
    prev_t: Optional[float] = None
    i = 0
    while i < len(events):
        t = events[i][0]
        if prev_t is not None and t > prev_t and in_collar == 0:
            r = frozenset(k for k, v in active["r"].items() if v > 0)
            h = frozenset(k for k, v in active["h"].items() if v > 0)
            if r or h:
                out.append((t - prev_t, r, h))
        while i < len(events) and events[i][0] == t:
            _, _, kind, spk, delta = events[i]
            if kind == "c":
                in_collar += delta
            else:
                active[kind][spk] = active[kind].get(spk, 0) + delta
            i += 1
        prev_t = t
    return out


def hungarian_max(weights: Sequence[Sequence[float]]) -> List[Tuple[int, int]]:
    """Maximum-weight one-to-one assignment (rows -> cols) for a rectangular matrix."""
    n_rows = len(weights)
    n_cols = len(weights[0]) if n_rows else 0
    n = max(n_rows, n_cols)
    if n == 0:
        return []
    big = max((w for row in weights for w in row), default=0.0)
    cost = [
        [big - (weights[r][c] if r < n_rows and c < n_cols else 0.0) for c in range(n)]
        for r in range(n)
    ]
    inf = float("inf")
    u = [0.0] * (n + 1)
    v = [0.0] * (n + 1)
    p = [0] * (n + 1)
    way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [inf] * (n + 1)
        used = [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            for j in range(1, n + 1):
                if used[j]:
                    continue
                cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j], way[j] = cur, j0
                if minv[j] < delta:
                    delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    pairs = []
    for j in range(1, n + 1):
        r, c = p[j] - 1, j - 1
        if r < n_rows and c < n_cols:
            pairs.append((r, c))
    return pairs


def diarization_error(
    reference: Iterable[Dict[str, Any]],
    hypothesis: Iterable[Dict[str, Any]],
    *,
    collar: float = DEFAULT_COLLAR,
) -> Dict[str, Any]:
    ref = _clean(reference)
    hyp = _clean(hypothesis)
    intervals = _elementary_intervals(ref, hyp, max(0.0, float(collar)))

    ref_speakers = sorted({s for _, _, s in ref})
    hyp_speakers = sorted({s for _, _, s in hyp})
    r_idx = {s: i for i, s in enumerate(ref_speakers)}
    h_idx = {s: i for i, s in enumerate(hyp_speakers)}
    overlap = [[0.0] * len(ref_speakers) for _ in hyp_speakers]
    for dur, r, h in intervals:
        for hs in h:
            for rs in r:
                overlap[h_idx[hs]][r_idx[rs]] += dur
    mapping: Dict[str, str] = {}
    for hi, ri in hungarian_max(overlap):
        if overlap[hi][ri] > 0:
            mapping[hyp_speakers[hi]] = ref_speakers[ri]

    total = miss = fa = conf = 0.0
    for dur, r, h in intervals:
        n_ref, n_hyp = len(r), len(h)
        correct = len(r & {mapping[s] for s in h if s in mapping})
        total += dur * n_ref
        miss += dur * max(0, n_ref - n_hyp)
        fa += dur * max(0, n_hyp - n_ref)
        conf += dur * (min(n_ref, n_hyp) - correct)

    def rate(x: float) -> Optional[float]:
        return round(x / total, 4) if total > 0 else None

    return {
        "der": rate(miss + fa + conf),
        "miss": rate(miss),
        "false_alarm": rate(fa),
        "confusion": rate(conf),
        "reference_speech_sec": round(total, 2),
        "reference_speakers": len(ref_speakers),
        "hypothesis_speakers": len(hyp_speakers),
        "mapping": mapping,
        "collar": collar,
    }


# ---------------------------------------------------------------------------
# Speaker identification threshold calibration
# ---------------------------------------------------------------------------

CURRENT_ID_THRESHOLDS = {"strict": 0.25, "moderate": 0.35, "loose": 0.45}


def _norm_name(value: str) -> str:
    return " ".join(str(value or "").replace("ё", "е").lower().strip().strip(".").split())


def suggest_id_thresholds(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Thresholds from labeled voices vs reference voices.

    rows: [{"name": employee name, "scores": {reference voice: cosine similarity}}].
    Positive pair = the employee's own reference voice, negative = any other.
    Pipeline thresholds are cosine *distances* (1 - similarity): a speaker is
    auto-named when distance <= strict. When the clouds overlap we favour
    avoiding wrong names (threshold just above the worst negative).
    """
    positives: List[float] = []
    negatives: List[float] = []
    for row in rows or []:
        own = _norm_name(row.get("name"))
        for ref, sim in (row.get("scores") or {}).items():
            try:
                value = float(sim)
            except (TypeError, ValueError):
                continue
            (positives if own and _norm_name(ref) == own else negatives).append(value)
    result: Dict[str, Any] = {
        "positives": len(positives),
        "negatives": len(negatives),
        "min_positive": round(min(positives), 4) if positives else None,
        "max_negative": round(max(negatives), 4) if negatives else None,
        "current": dict(CURRENT_ID_THRESHOLDS),
        "separable": None,
        "suggested": None,
    }
    if not positives:
        result["note"] = "Нет эталонов для размеченных сотрудников — сначала запишите голоса"
        return result
    min_pos = min(positives)
    if not negatives:
        similarity = min_pos - 0.05
        result["separable"] = True
        result["note"] = "Нет чужих эталонов для сравнения — порог ориентировочный"
    elif min_pos > max(negatives):
        similarity = (min_pos + max(negatives)) / 2
        result["separable"] = True
    else:
        similarity = max(negatives) + 0.02
        result["separable"] = False
        result["note"] = ("Свои и чужие голоса пересекаются — порог выбран так, чтобы не "
                          "подписывать чужие голоса; часть своих останется «неизвестными»")
    strict = round(min(1.0, max(0.05, 1.0 - similarity)), 2)
    result["suggested"] = {
        "strict": strict,
        "moderate": round(min(1.0, strict + 0.07), 2),
        "loose": round(min(1.0, strict + 0.15), 2),
        "similarity": round(similarity, 4),
    }
    return result
