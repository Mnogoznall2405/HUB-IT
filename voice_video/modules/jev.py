# -*- coding: utf-8 -*-
"""Клиент TypeSafe Jev (Decisions API через OpenRouter).

Jev не генерирует текст — отвечает типизированными вероятностями:
  - noul:  {"noul": 0..1}
  - choice: {"choice": key, "confidence": .., "probabilities": {..}}
  - score:  {"score": idx, "probabilities": {..}}

Используется как дешёвый верификационный слой:
дедуп соседних тем после оконной сегментации и проверка полноты протокола.
"""
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

import requests

from config import (OPENROUTER_KEY, JEV_ENABLED, JEV_DEDUP_THRESHOLD, JEV_COVERAGE_THRESHOLD, JEV_MODEL,
                    JEV_DOMAIN_TAGS, JEV_PROTOCOL_GUARD, JEV_GUARD_SUPPORT_MIN, JEV_GUARD_OWNER_MIN)

logger = logging.getLogger(__name__)

JEV_URL = 'https://openrouter.ai/api/alpha/decisions'


_SHARED_CLIENT: Any = None  # None — ещё не пробовали, False — shared.llm недоступен


def _shared_client():
    """Клиент Jev из shared.llm (правило репозитория: LLM-вызовы идут через shared/llm); False, если импорт невозможен."""
    global _SHARED_CLIENT
    if _SHARED_CLIENT is None:
        try:
            root = Path(__file__).resolve().parents[2]
            if (root / 'shared' / 'llm' / 'jev_client.py').exists() and str(root) not in sys.path:
                sys.path.insert(0, str(root))
            os.environ.setdefault('JEV_API_KEY', OPENROUTER_KEY or '')
            from shared.llm.jev_client import jev_client
            _SHARED_CLIENT = jev_client
        except Exception as e:  # noqa: BLE001 - пайплайн переносим: без shared работаем напрямую
            logger.info(f"Jev: shared.llm недоступен ({e}) — прямой вызов")
            _SHARED_CLIENT = False
    return _SHARED_CLIENT


def jev_decide(state: Any, questions: Dict[str, Dict],
               model: str = JEV_MODEL, timeout: int = 45, retries: int = 2) -> Optional[Dict[str, Dict]]:
    """Один вызов Jev. Возвращает {qid: answer} или None при сбое."""
    if not (JEV_ENABLED and OPENROUTER_KEY):
        return None
    client = _shared_client()
    if client:
        try:
            decision = client.decide(state=state, questions=questions, model=model, timeout=timeout,
                                     max_retries=retries)
            return {name: dict(getattr(answer, 'raw', None) or {}) for name, answer in decision.answers.items()}
        except Exception as e:  # noqa: BLE001 - JevClientError и сеть: протокол без Jev лучше, чем без протокола
            logger.warning(f"Jev недоступен: {e}")
            return None
    body = {'model': model, 'state': state, 'questions': questions}
    for attempt in range(retries + 1):
        try:
            r = requests.post(
                JEV_URL,
                headers={'Authorization': f'Bearer {OPENROUTER_KEY}'},
                json=body,
                timeout=timeout
            )
            if r.status_code == 200:
                data = r.json()
                answers = data.get('answers') if isinstance(data, dict) else None
                return answers or data
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            logger.warning(f"Jev: HTTP {r.status_code}: {r.text[:200]}")
            return None
        except Exception as e:
            if attempt < retries:
                time.sleep(1.0)
                continue
            logger.warning(f"Jev недоступен: {e}")
            return None
    return None


def _noul(answer: Optional[Dict]) -> Optional[float]:
    if isinstance(answer, dict) and 'noul' in answer:
        try:
            return float(answer['noul'])
        except (TypeError, ValueError):
            return None
    return None


def merge_duplicate_topics(topics: List[Dict], batch_size: int = 5,
                           threshold: float = JEV_DEDUP_THRESHOLD) -> List[Dict]:
    """Сливает соседние темы-дубликаты (артефакт оконной сегментации).

    По batch_size пар за вызов. noul>=threshold → тема i+1 сливается в i.
    """
    if len(topics) < 2 or not JEV_ENABLED:
        return topics

    pairs = [(i, i + 1) for i in range(len(topics) - 1)]
    merge_into: Dict[int, int] = {}  # j -> i

    for gs in range(0, len(pairs), batch_size):
        group = pairs[gs:gs + batch_size]
        state_pairs = []
        questions = {}
        for k, (i, j) in enumerate(group):
            a, b = topics[i], topics[j]
            state_pairs.append({
                'pair_id': k,
                'A': {'title': a.get('topic_title', ''), 'summary': (a.get('summary') or '')[:900]},
                'B': {'title': b.get('topic_title', ''), 'summary': (b.get('summary') or '')[:900]},
            })
            questions[f'pair_{k}'] = {
                'type': 'noul',
                'instructions': ('Описывают ли A и B одну и ту же тему обсуждения '
                                 '(дубликат из-за разбиения), а не две разные темы?'),
                'criteria': {
                    'true': 'Одна и та же тема — объединить',
                    'false': 'Разные или смежные темы — оставить раздельно'
                }
            }
        answers = jev_decide({'pairs': state_pairs}, questions)
        if not answers:
            logger.warning("⚠️ Jev: дедуп-вызов не удался — пропускаю группу")
            continue
        for k, (i, j) in enumerate(group):
            p = _noul(answers.get(f'pair_{k}'))
            if p is not None and p >= threshold:
                merge_into[j] = i
                logger.info(f"🔀 Jev: темы {i + 1} и {j + 1} — дубликаты (p={p:.2f})")

    if not merge_into:
        return topics

    # Склеиваем: j уходит в i (учитываем цепочки i->i-1)
    def root(x: int) -> int:
        while x in merge_into:
            x = merge_into[x]
        return x

    merged: List[Dict] = []
    index_map: Dict[int, int] = {}
    for idx, t in enumerate(topics):
        r = root(idx)
        if r != idx:
            continue
        index_map[r] = len(merged)
        merged.append(dict(t))
    for idx, t in enumerate(topics):
        r = root(idx)
        if r == idx:
            continue
        tgt = merged[index_map[r]]
        tgt['end_time'] = max(tgt.get('end_time') or 0, t.get('end_time') or 0)
        # более информативное summary — длинное; заголовок сохраняем первый
        if len(t.get('summary') or '') > len(tgt.get('summary') or ''):
            tgt['summary'] = t['summary']
        for key in ('key_decisions', 'action_items', 'open_questions', 'participants'):
            seen = {str(x) for x in tgt.get(key) or []}
            tgt[key] = (tgt.get(key) or []) + [x for x in (t.get(key) or []) if str(x) not in seen]

    logger.info(f"🔀 Jev: {len(topics)} тем → {len(merged)} после дедупликации")
    return merged


def check_protocol_coverage(topics: List[Dict], protocol_md: str,
                            batch_size: int = 5,
                            threshold: float = JEV_COVERAGE_THRESHOLD,
                            max_decisions: int = 40) -> List[str]:
    """Проверяет, что каждое ключевое решение из тем попало в протокол.

    Возвращает список пропущенных решений (для приложения к протоколу).
    """
    if not (JEV_ENABLED and protocol_md):
        return []
    decisions: List[str] = []
    for t in topics:
        for d in (t.get('key_decisions') or []):
            decisions.append(str(d))
    decisions = decisions[:max_decisions]
    if not decisions:
        return []

    # Протокол передаём целиком — контекст Jev 32-64k токенов;
    # обрезка давала ложные "пропуски" для решений из конца протокола
    missed: List[str] = []
    for gs in range(0, len(decisions), batch_size):
        group = decisions[gs:gs + batch_size]
        questions = {}
        for k, d in enumerate(group):
            questions[f'cov_{k}'] = {
                'type': 'noul',
                'instructions': 'Зафиксировано ли это решение в тексте протокола (в любой формулировке)?',
                'criteria': {
                    'true': 'Решение отражено в протоколе',
                    'false': 'Решения нет в протоколе'
                }
            }
        answers = jev_decide(
            {'protocol': protocol_md, 'decisions': group}, questions)
        if not answers:
            logger.warning("⚠️ Jev: проверка покрытия не удалась — пропускаю группу")
            continue
        for k, d in enumerate(group):
            p = _noul(answers.get(f'cov_{k}'))
            if p is not None and p < threshold:
                missed.append(d)
                logger.info(f"🚩 Jev: решение не попало в протокол (p={p:.2f}): {d[:80]}")

    return missed


def tag_topic_domains(topics: List[Dict]) -> int:
    """Направление каждой темы (стройка/финансы/снабжение…) — поля domain, domain_confidence, domain_alt."""
    if not (JEV_ENABLED and JEV_DOMAIN_TAGS and topics):
        return 0
    from .protocol_guard import classify_topics
    tagged = classify_topics(topics, jev_decide)
    logger.info(f"🏷️ Jev: направление проставлено у {tagged} из {len(topics)} тем")
    return tagged


def guard_registry_items(groups: List[Dict], topics: List[Dict], transcript: List[Dict]) -> int:
    """Сторож реестра: сомнительным поручениям ставит flags (рисуются как «⚠ проверить: …»)."""
    if not (JEV_ENABLED and JEV_PROTOCOL_GUARD and groups):
        return 0
    from .protocol_guard import check_items
    flagged = check_items(groups, topics, transcript, jev_decide,
                          support_min=JEV_GUARD_SUPPORT_MIN, owner_min=JEV_GUARD_OWNER_MIN)
    if flagged:
        logger.info(f"⚠️ Jev: сомнительных поручений: {flagged}")
    return flagged
