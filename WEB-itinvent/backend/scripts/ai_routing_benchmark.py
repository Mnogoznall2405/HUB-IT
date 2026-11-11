#!/usr/bin/env python3
"""Benchmark of the Jev tool-group routing used by the HUB assistant.

Runs a labelled set of Russian user requests through the real
``_route_tool_groups_jev`` (live Jev calls, no production data touched) and
reports per request set: group accuracy, missed groups (critical: the model
would not get the tool it needs), extra groups (only extra prompt weight),
latency p50/p95 and cost. The deterministic fallback used when Jev fails is
measured on the same set for comparison.

Usage (from WEB-itinvent, sqlite URLs keep the app DB untouched):

    set APP_DATABASE_URL=sqlite:///%TEMP%\\routing_bench_app.db
    set CHAT_DATABASE_URL=sqlite:///%TEMP%\\routing_bench_chat.db
    python -m backend.scripts.ai_routing_benchmark [--out report.json]
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

os.environ["AI_JEV_ROUTING"] = "1"

ALL_GROUPS = {
    "itinvent", "office", "files", "mfu", "network", "ad", "kb", "chat", "self", "directory", "warehouse",
}

# (request, expected groups). An empty set means "no tools needed".
CASES: list[tuple[str, set[str]]] = [
    # itinvent
    ("Найди ноутбук с инвентарным номером 100234", {"itinvent"}),
    ("Что числится за Ивановым из бухгалтерии?", {"itinvent"}),
    ("Покажи историю перемещений монитора с серийником 7XK21", {"itinvent"}),
    ("Какие акты передачи не подписаны?", {"itinvent"}),
    ("Сколько компьютеров в филиале Москва?", {"itinvent"}),
    ("Какие расходники закончились?", {"itinvent"}),
    # office
    ("Найди письма от поставщика за эту неделю", {"office"}),
    ("Какие у меня задачи на сегодня?", {"office"}),
    ("Создай задачу позвонить подрядчику завтра", {"office"}),
    ("Ответь на последнее письмо директора, что согласен", {"office"}),
    ("Покажи анонсы компании за месяц", {"office"}),
    # mfu
    ("Сколько МФУ сейчас онлайн?", {"mfu"}),
    ("Сколько страниц напечатал принтер в бухгалтерии в этом месяце?", {"mfu"}),
    ("Какие принтеры сейчас с ошибкой?", {"mfu"}),
    # network
    ("К какому порту коммутатора подключена розетка 12-A-04?", {"network"}),
    ("Покажи патч-панели в серверной", {"network"}),
    ("Найди свободные порты на коммутаторе второго этажа", {"network"}),
    # ad
    ("Когда у пользователя petrov истекает пароль?", {"ad"}),
    ("Сколько дней осталось до смены пароля у ivanova?", {"ad"}),
    # kb
    ("Как настроить VPN? Найди в базе знаний", {"kb"}),
    ("Есть ли инструкция по подключению к Wi-Fi?", {"kb"}),
    ("Пришли файл инструкции по установке 1С", {"kb"}),
    # chat
    ("Напиши Петрову в чат, что совещание переносится на 15:00", {"chat"}),
    ("Отправь в группу бухгалтерии напоминание про отчёт", {"chat"}),
    # self
    ("Какой у меня компьютер и сколько ему лет?", {"self"}),
    ("Какая техника закреплена за мной?", {"self"}),
    ("Хочу оформить обращение в IT: не работает принтер", {"self"}),
    # directory
    ("Какой рабочий телефон у Смирновой из отдела кадров?", {"directory"}),
    ("Кто руководитель отдела закупок?", {"directory"}),
    ("Кто сейчас в отпуске из бухгалтерии?", {"directory"}),
    # warehouse
    ("Сколько картриджей HP 85A осталось на складе?", {"warehouse"}),
    ("Покажи заявки на закупку ИТ-оборудования", {"warehouse"}),
    # files
    ("Сделай отчёт по технике в формате Excel", {"files", "itinvent"}),
    ("Составь таблицу по принтерам и выгрузи в xlsx", {"files", "mfu"}),
    # multi-domain
    ("Найди принтер в кабинете 305 и покажи, к какой розетке он подключён", {"itinvent", "network"}),
    ("Какой ноутбук у Иванова и когда ему менять пароль?", {"itinvent", "ad"}),
    ("Напиши Сидорову письмо с отчётом по МФУ", {"office", "mfu"}),
    # smalltalk / no tools
    ("Привет", set()),
    ("Спасибо!", set()),
    ("Ок, понял", set()),
    ("Что ты умеешь?", set()),
    ("Объясни, чем отличается SSD от HDD", set()),
    ("Переведи на английский: добрый день, коллеги", set()),
    ("Напиши короткое поздравление с днём рождения коллеге", set()),
    ("Какая сегодня погода в Москве?", set()),
    # tricky wording
    ("Он в сети?", set()),
    ("Что с ним?", set()),
    ("Скинь мне то, что просил Иванов", set()),
    ("принтер не печатает", {"mfu"}),
    ("не могу войти в почту", {"office"}),
    ("забыл пароль от учётки", {"ad"}),
    ("где лежит инструкция по принтерам", {"kb"}),
    ("сколько стоит картридж на складе", {"warehouse"}),
    ("мой комп тормозит", {"self"}),
    ("как позвонить в бухгалтерию", {"directory"}),
]


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(pct / 100 * (len(ordered) - 1)))))
    return ordered[index]


def _score(predicted: set[str], expected: set[str]) -> dict[str, object]:
    missed = expected - predicted
    extra = predicted - expected
    return {"exact": not missed and not extra, "missed": sorted(missed), "extra": sorted(extra)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="", help="write the full JSON report here")
    args = parser.parse_args()

    from backend.ai_chat import service
    from shared.llm import jev_client

    if not jev_client.is_configured():
        print("Jev is not configured (JEV_API_KEY / OPENROUTER_API_KEY).")
        return 2

    rows = []
    latencies: list[float] = []
    fallback_exact = 0
    for index, (text, expected) in enumerate(CASES):
        started = time.perf_counter()
        predicted = service._route_tool_groups_jev(trigger_text=text, available_groups=set(ALL_GROUPS))
        elapsed = time.perf_counter() - started
        fallback = service._jev_fallback_groups(trigger_text=text, available_groups=set(ALL_GROUPS))
        predicted = set(predicted or set())
        scored = _score(predicted, expected)
        fallback_score = _score(set(fallback or set()), expected)
        fallback_exact += 1 if fallback_score["exact"] else 0
        latencies.append(elapsed * 1000)
        rows.append({
            "text": text, "expected": sorted(expected), "predicted": sorted(predicted),
            "ms": round(elapsed * 1000), **scored, "fallback_exact": fallback_score["exact"],
        })
        time.sleep(0.05)

    total = len(rows)
    exact = sum(1 for row in rows if row["exact"])
    missed_cases = [row for row in rows if row["missed"]]
    extra_cases = [row for row in rows if row["extra"]]
    needs_tools = [row for row in rows if row["expected"]]
    recall = sum(1 for row in needs_tools if not row["missed"]) / max(1, len(needs_tools))
    summary = {
        "cases": total,
        "exact_match": f"{exact}/{total}",
        "recall_no_missed_group": f"{sum(1 for r in needs_tools if not r['missed'])}/{len(needs_tools)} ({recall:.0%})",
        "cases_with_extra_groups": len(extra_cases),
        "latency_ms_p50": round(_percentile(latencies, 50)),
        "latency_ms_p95": round(_percentile(latencies, 95)),
        "latency_ms_mean": round(statistics.mean(latencies)),
        "fallback_exact_match": f"{fallback_exact}/{total}",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missed_cases:
        print("\nПРОПУЩЕНЫ нужные группы (критично):")
        for row in missed_cases:
            print(f"  - {row['text']!r}: нужно {row['expected']}, получено {row['predicted']}")
    if extra_cases:
        print("\nЛишние группы (только вес промпта):")
        for row in extra_cases[:15]:
            print(f"  - {row['text']!r}: нужно {row['expected']}, получено {row['predicted']}")
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nreport: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
