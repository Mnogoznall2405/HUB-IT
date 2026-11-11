#!/usr/bin/env python3
"""AG-5: сравнение моделей LLM на наборе типовых вопросов к HUB Ассистенту.

Прогоняет вопросы из ``backend/ai_chat/eval_questions.json`` через существующий
шлюз ``shared/llm`` (RouterAI/OpenRouter) и собирает markdown-отчёт:
модель × качество (ручная оценка) / скорость / стоимость.

Режимы:
    answer  — обычный ответ ассистента (streaming: TTFT + полное время,
              текст ответа в отчёте для ручной оценки качества);
    route   — выбор групп инструментов (JSON), автоматическая сверка
              с expected_groups из набора (полнота recall, лишние группы).

Примеры:
    python -m backend.scripts.compare_ai_models --dry-run
    python -m backend.scripts.compare_ai_models \
        --models google/gemini-3.7-flash,openai/gpt-4o-mini \
        --questions backend/ai_chat/eval_questions.json \
        --output ai_model_compare.md
    python -m backend.scripts.compare_ai_models --mode route \
        --models google/gemini-3.7-flash --pricing pricing.json

Без ключа провайдера (ROUTERAI_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY)
скрипт завершается с сообщением, без traceback.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

DEFAULT_QUESTIONS_PATH = WEB_ROOT / "backend" / "ai_chat" / "eval_questions.json"

# Группы инструментов — зеркало AI_TOOL_GROUP_* из backend/ai_chat/tools/context.py.
# Держать синхронно: скрипт намеренно самодостаточный и не импортирует backend,
# чтобы работать без конфигурации БД.
TOOL_GROUPS = ("itinvent", "office", "files", "mfu", "network", "ad", "kb", "chat", "other")

ANSWER_SYSTEM_PROMPT = (
    "Ты корпоративный AI-ассистент HUB. Отвечай по-русски, чётко и по делу. "
    "Если вопрос требует живых данных внутренних систем (ITinvent, AD, почта, задачи, "
    "база знаний), которые в этом диалоге тебе недоступны, скажи об этом прямо и предложи, "
    "как уточнить запрос. Не выдумывай факты и данные."
)

ROUTE_SYSTEM_PROMPT = (
    "Ты маршрутизатор корпоративного ассистента HUB. По вопросу сотрудника выбери, "
    "какие группы инструментов понадобятся для полного ответа. Группы:\n"
    "- itinvent: поиск и карточки техники, сотрудники, справочники, история, акты, "
    "черновики перемещений/статусов/расходников;\n"
    "- office: почта (поиск, письма, черновики писем), задачи, объявления, сводка дня;\n"
    "- files: создание файлов и отчётов, конвертация документов;\n"
    "- mfu: МФУ и принтеры — список, статус, счётчики страниц;\n"
    "- network: ping, DNS, SSL, порты коммутаторов, розетки, Wake-on-LAN;\n"
    "- ad: Active Directory — пароли, блокировки, группы, история входов;\n"
    "- kb: база знаний — статьи и вложения;\n"
    "- chat: поиск людей и бесед, черновик сообщения;\n"
    "- other: свободный разговор без инструментов.\n"
    "Ответь строго JSON вида {\"groups\": [\"itinvent\", ...]}. "
    "Если инструменты не нужны — верни {\"groups\": []}."
)

ROUTE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {"type": "string", "enum": list(TOOL_GROUPS)},
        },
    },
    "required": ["groups"],
    "additionalProperties": False,
}


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _load_questions(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("questions") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise ValueError(f"В файле {path} нет списка вопросов")
    questions: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not _normalize_text(item.get("question")):
            raise ValueError(f"Вопрос #{index + 1} в {path}: ожидается объект с полем 'question'")
        expected = [_normalize_text(g) for g in list(item.get("expected_groups") or []) if _normalize_text(g)]
        questions.append(
            {
                "id": _normalize_text(item.get("id")) or f"q-{index + 1}",
                "category": _normalize_text(item.get("category")) or "misc",
                "question": _normalize_text(item.get("question")),
                "expected_groups": expected,
                "requires_permission": _normalize_text(item.get("requires_permission")),
            }
        )
    return questions


def _load_pricing(path: Path | None) -> dict[str, dict[str, float]]:
    """Опциональный файл {model: {"prompt": <$/1M>, "completion": <$/1M>}}."""
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"В файле {path} ожидается объект {{model: {{prompt, completion}}}}")
    result: dict[str, dict[str, float]] = {}
    for model, price in payload.items():
        if not isinstance(price, dict):
            continue
        result[_normalize_text(model)] = {
            "prompt": float(price.get("prompt") or price.get("input") or 0.0),
            "completion": float(price.get("completion") or price.get("output") or 0.0),
        }
    return result


def _fmt_seconds(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def _fmt_tokens(value: float | None) -> str:
    return "—" if value is None else f"{value:,.0f}".replace(",", " ")


def _usage_from_stream_chunk(chunk: Any) -> dict[str, int] | None:
    usage = getattr(chunk, "usage", None)
    if usage is None:
        return None
    return {
        "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
        "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


def _delta_text(chunk: Any) -> str:
    try:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            return ""
        delta = getattr(choices[0], "delta", None)
        content = getattr(delta, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                str(item.get("text") or "")
                for item in content
                if isinstance(item, dict)
            )
    except Exception:
        return ""
    return ""


def _run_answer(client: Any, *, model: str, question: str, temperature: float,
                max_tokens: int, timeout: float | None) -> dict[str, Any]:
    """Обычный ответ: streaming — замер TTFT и полного времени."""
    started = time.perf_counter()
    first_token_at: float | None = None
    parts: list[str] = []
    usage: dict[str, int] | None = None
    stream = client.stream_chat_completion(
        messages=[
            {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    for chunk in stream:
        chunk_usage = _usage_from_stream_chunk(chunk)
        if chunk_usage is not None:
            usage = chunk_usage
        text = _delta_text(chunk)
        if text:
            if first_token_at is None:
                first_token_at = time.perf_counter()
            parts.append(text)
    total = time.perf_counter() - started
    return {
        "answer": "".join(parts).strip(),
        "ttft_sec": (first_token_at - started) if first_token_at is not None else None,
        "total_sec": total,
        "usage": usage or {},
        "error": "",
    }


def _run_route(client: Any, *, model: str, question: str, expected_groups: list[str],
               temperature: float, timeout: float | None) -> dict[str, Any]:
    """Выбор групп инструментов: complete_json + сверка с expected_groups."""
    started = time.perf_counter()
    payload, usage = client.complete_json(
        system_prompt=ROUTE_SYSTEM_PROMPT,
        user_prompt=question,
        model=model,
        temperature=temperature,
        max_tokens=300,
        response_schema=ROUTE_RESPONSE_SCHEMA,
        schema_name="ai_tool_group_route",
        strict_json_schema=False,
        timeout=timeout,
    )
    total = time.perf_counter() - started
    raw_groups = payload.get("groups") if isinstance(payload, dict) else None
    chosen = [
        _normalize_text(group)
        for group in list(raw_groups or [])
        if _normalize_text(group) in TOOL_GROUPS
    ]
    # 'other' — не инструментальная группа; при сравнении с пустым эталоном не считаем её лишней.
    chosen_tools = [group for group in chosen if group != "other"]
    expected = list(expected_groups or [])
    expected_set = set(expected)
    covered = expected_set & set(chosen_tools)
    missed = [group for group in expected if group not in chosen_tools]
    extra = [group for group in chosen_tools if group not in expected_set]
    return {
        "chosen_groups": chosen,
        "route_ok": not missed,
        "route_recall": (len(covered) / len(expected_set)) if expected_set else (0.0 if chosen_tools else 1.0),
        "route_missed": missed,
        "route_extra": extra,
        "total_sec": total,
        "usage": usage or {},
        "error": "",
    }


def _cost_per_100(usage_totals: dict[str, float], pricing: dict[str, float] | None) -> float | None:
    if not pricing:
        return None
    cost = (usage_totals.get("prompt_tokens", 0.0) / 1_000_000.0) * float(pricing.get("prompt") or 0.0)
    cost += (usage_totals.get("completion_tokens", 0.0) / 1_000_000.0) * float(pricing.get("completion") or 0.0)
    answers = max(1.0, float(usage_totals.get("answers", 0.0) or 0.0))
    return cost / answers * 100.0


def _render_report(*, mode: str, models: list[str], questions: list[dict[str, Any]],
                   results: dict[str, dict[str, dict[str, Any]]],
                   pricing: dict[str, dict[str, float]], questions_path: Path) -> str:
    lines: list[str] = []
    lines.append("# Сравнение моделей ИИ (AG-5)")
    lines.append("")
    lines.append(f"- Дата прогона: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"- Набор вопросов: `{questions_path}` ({len(questions)} шт.)")
    lines.append(f"- Режим: `{mode}` ({'ответы для ручной оценки' if mode == 'answer' else 'выбор групп инструментов, авто-сверка'})")
    lines.append("- Качество ответа оценивается вручную по текстам в разделе «Детали» (шкала 0–5).")
    lines.append("")
    lines.append("## Сводка")
    lines.append("")
    if mode == "answer":
        lines.append("| Модель | Ответов | Ошибок | Ср. TTFT, с | Ср. полное время, с | Токены in | Токены out | Стоимость /100 запросов | Качество (0–5) |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
    else:
        lines.append("| Модель | Ответов | Ошибок | Recall групп | Лишних групп (ср.) | Ср. время, с | Токены in | Токены out | Стоимость /100 запросов |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
    for model in models:
        cells = results.get(model) or {}
        ok_rows = [row for row in cells.values() if not row.get("error")]
        err_count = sum(1 for row in cells.values() if row.get("error"))
        totals: dict[str, float] = {
            "prompt_tokens": sum(float((row.get("usage") or {}).get("prompt_tokens", 0) or 0) for row in ok_rows),
            "completion_tokens": sum(float((row.get("usage") or {}).get("completion_tokens", 0) or 0) for row in ok_rows),
            "answers": float(len(ok_rows)),
        }
        cost = _cost_per_100(totals, pricing.get(model))
        cost_text = "—" if cost is None else f"~${cost:.3f}"
        if mode == "answer":
            ttft_values = [row["ttft_sec"] for row in ok_rows if row.get("ttft_sec") is not None]
            total_values = [row["total_sec"] for row in ok_rows if row.get("total_sec") is not None]
            avg_ttft = (sum(ttft_values) / len(ttft_values)) if ttft_values else None
            avg_total = (sum(total_values) / len(total_values)) if total_values else None
            lines.append(
                f"| `{model}` | {len(ok_rows)} | {err_count} | {_fmt_seconds(avg_ttft)} | "
                f"{_fmt_seconds(avg_total)} | {_fmt_tokens(totals['prompt_tokens'])} | "
                f"{_fmt_tokens(totals['completion_tokens'])} | {cost_text} |  |"
            )
        else:
            recall_values = [row["route_recall"] for row in ok_rows]
            extra_counts = [float(len(row.get("route_extra") or [])) for row in ok_rows]
            total_values = [row["total_sec"] for row in ok_rows if row.get("total_sec") is not None]
            avg_recall = (sum(recall_values) / len(recall_values)) if recall_values else None
            avg_extra = (sum(extra_counts) / len(extra_counts)) if extra_counts else None
            avg_total = (sum(total_values) / len(total_values)) if total_values else None
            recall_text = "—" if avg_recall is None else f"{avg_recall * 100:.0f}%"
            extra_text = "—" if avg_extra is None else f"{avg_extra:.2f}"
            lines.append(
                f"| `{model}` | {len(ok_rows)} | {err_count} | {recall_text} | {extra_text} | "
                f"{_fmt_seconds(avg_total)} | {_fmt_tokens(totals['prompt_tokens'])} | "
                f"{_fmt_tokens(totals['completion_tokens'])} | {cost_text} |"
            )
    lines.append("")
    if not pricing:
        lines.append("> Стоимость не посчитана: передайте `--pricing pricing.json` "
                     "вида `{\"model\": {\"prompt\": <$/1M>, \"completion\": <$/1M>}}`.")
        lines.append("")
    lines.append("## Детали по вопросам")
    lines.append("")
    for question in questions:
        expected = ", ".join(question["expected_groups"]) or "—"
        lines.append(f"### {question['id']} · {question['category']}")
        lines.append("")
        lines.append(f"> {question['question']}")
        lines.append("")
        lines.append(f"Ожидаемые группы: `{expected}`")
        if question.get("requires_permission"):
            lines.append(f" · требуется право `{question['requires_permission']}`")
        lines.append("")
        for model in models:
            row = (results.get(model) or {}).get(question["id"])
            if row is None:
                continue
            if row.get("error"):
                lines.append(f"- `{model}`: **ошибка** — {row['error']}")
                continue
            if mode == "route":
                chosen = ", ".join(row.get("chosen_groups") or []) or "—"
                verdict = "ok" if row.get("route_ok") else f"пропущено: {', '.join(row.get('route_missed') or [])}"
                extra = row.get("route_extra") or []
                suffix = f", лишние: {', '.join(extra)}" if extra else ""
                lines.append(
                    f"- `{model}`: группы `{chosen}` — {verdict}{suffix} "
                    f"({_fmt_seconds(row.get('total_sec'))} с)"
                )
            else:
                answer = _normalize_text(row.get("answer"))
                lines.append(
                    f"- `{model}`: TTFT {_fmt_seconds(row.get('ttft_sec'))} с, "
                    f"всего {_fmt_seconds(row.get('total_sec'))} с"
                )
                if answer:
                    lines.append("")
                    lines.append("  ```text")
                    lines.append("  " + answer[:4000].replace("\n", "\n  "))
                    lines.append("  ```")
        lines.append("")
    lines.append("## Оценка качества (заполняется вручную)")
    lines.append("")
    lines.append("| Модель | Качество (0–5) | Комментарий |")
    lines.append("|---|---|---|")
    for model in models:
        lines.append(f"| `{model}` |  |  |")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="AG-5: сравнение моделей LLM на типовых вопросах ассистента.",
    )
    parser.add_argument("--models", default="", help="Модели через запятую (по умолчанию — настроенная chat-модель)")
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS_PATH), help="JSON-файл с вопросами")
    parser.add_argument("--output", default="ai_model_compare.md", help="Куда писать markdown-отчёт")
    parser.add_argument("--mode", choices=("answer", "route"), default="answer",
                        help="answer — текст ответа для ручной оценки; route — выбор групп инструментов с авто-сверкой")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--max-tokens", type=int, default=1200)
    parser.add_argument("--timeout", type=float, default=90.0, help="Таймаут одного запроса, сек")
    parser.add_argument("--limit", type=int, default=0, help="Ограничить число вопросов (smoke-прогон)")
    parser.add_argument("--pricing", default="", help="JSON с ценами {model: {prompt, completion}} за 1M токенов")
    parser.add_argument("--dry-run", action="store_true", help="Показать план без обращений к API")
    args = parser.parse_args(argv)

    questions_path = Path(args.questions)
    if not questions_path.is_absolute():
        questions_path = (Path.cwd() / questions_path).resolve()
    try:
        questions = _load_questions(questions_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Не удалось прочитать набор вопросов {questions_path}: {exc}", file=sys.stderr)
        return 1
    if args.limit and args.limit > 0:
        questions = questions[: args.limit]

    from shared.llm import OpenRouterClient, resolve_model  # noqa: E402

    models = [_normalize_text(item) for item in str(args.models or "").split(",") if _normalize_text(item)]
    if not models:
        models = [resolve_model("chat")]

    try:
        pricing = _load_pricing(Path(args.pricing)) if _normalize_text(args.pricing) else {}
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Не удалось прочитать pricing {args.pricing}: {exc}", file=sys.stderr)
        return 1

    print(f"Режим: {args.mode}; модели: {', '.join(models)}; вопросов: {len(questions)}")
    if args.dry_run:
        print("Dry-run: вызовы к LLM не выполняются.")
        for question in questions:
            expected = ", ".join(question["expected_groups"]) or "—"
            print(f"  [{question['id']}] ({question['category']}) {question['question']}  ->  {expected}")
        print(f"Отчёт будет записан в: {Path(args.output).resolve()}")
        return 0

    client = OpenRouterClient(request_timeout_sec=float(args.timeout))
    if not client.is_configured():
        print(
            "Ключ провайдера ИИ не настроен (ROUTERAI_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY). "
            "Задайте ключ в окружении или в корневом .env и повторите прогон.",
            file=sys.stderr,
        )
        return 1

    results: dict[str, dict[str, dict[str, Any]]] = {model: {} for model in models}
    for model in models:
        for question in questions:
            label = f"{model} · {question['id']}"
            try:
                if args.mode == "route":
                    row = _run_route(
                        client,
                        model=model,
                        question=question["question"],
                        expected_groups=question["expected_groups"],
                        temperature=float(args.temperature),
                        timeout=float(args.timeout),
                    )
                else:
                    row = _run_answer(
                        client,
                        model=model,
                        question=question["question"],
                        temperature=float(args.temperature),
                        max_tokens=int(args.max_tokens),
                        timeout=float(args.timeout),
                    )
            except Exception as exc:  # noqa: BLE001 — один сбой не должен ронять прогон
                row = {"error": f"{type(exc).__name__}: {exc}"}
                print(f"[fail] {label}: {row['error']}", file=sys.stderr)
            else:
                verdict = ""
                if args.mode == "route":
                    verdict = " ok" if row.get("route_ok") else f" miss={','.join(row.get('route_missed') or [])}"
                print(f"[ok] {label}: {_fmt_seconds(row.get('total_sec'))} с{verdict}")
            results[model][question["id"]] = row

    report = _render_report(
        mode=args.mode,
        models=models,
        questions=questions,
        results=results,
        pricing=pricing,
        questions_path=questions_path,
    )
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = (Path.cwd() / output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(f"Отчёт записан: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
