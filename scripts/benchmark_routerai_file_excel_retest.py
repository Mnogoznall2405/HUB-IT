"""Focused follow-up for the location reconciliation part of the XLSX benchmark."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
from pathlib import Path
import re
import sys
import time
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.benchmark_routerai_corporate import _extract_completion_text, _parse_json  # noqa: E402
from scripts.benchmark_routerai_file_excel import _build_dataset, _csv_text, _safe_formula  # noqa: E402
from shared.llm.client import OpenRouterClient  # noqa: E402


def _focused_prompt() -> tuple[str, set[str]]:
    dataset = _build_dataset()
    selected_numbers = set(range(1, 151)) | set(range(2951, 3081))
    selected_ids = {f"A{number:06d}" for number in selected_numbers}
    assets = []
    seen_assets = set()
    for row in dataset["assets"]:
        if row["asset_id"] in selected_ids and row["asset_id"] not in seen_assets:
            assets.append(row)
            seen_assets.add(row["asset_id"])
    movements = [row for row in dataset["movements"] if row["asset_id"] in selected_ids]
    expected = {f"A{number:06d}" for number in range(3001, 3031)}
    assets_csv = _csv_text(list(assets[0]), assets)
    movements_csv = _csv_text(list(movements[0]), movements)
    prompt = f"""Выполни контрольную сверку двух CSV-файлов. Используй только данные файлов.

Для каждого asset_id возьми ровно одно самое позднее перемещение по максимальному moved_at. Если current_location актива не совпадает с to_location этого перемещения, включи asset_id в location_mismatch_asset_ids. Более старые перемещения игнорируй. Порядок строк не является признаком актуальности.

Также предложи две обычные Excel-формулы без XLOOKUP/FILTER/INDIRECT/OFFSET:
- latest_timestamp_formula для J2 листа Активы через MAXIFS;
- mismatch_flag_formula для K2, которая сравнивает F2 с площадкой последнего перемещения через INDEX/MATCH и возвращает «Расхождение» либо пустую строку.

Верни только JSON:
{{"asset_rows":number,"movement_rows":number,"location_mismatch_count":number,"location_mismatch_asset_ids":[string],"latest_timestamp_formula":string,"mismatch_flag_formula":string}}

<file name="assets_subset.csv">\n{assets_csv}</file>

<file name="movements_subset.csv">\n{movements_csv}</file>"""
    return prompt, expected


def _score(parsed: dict[str, Any] | None, expected: set[str]) -> tuple[int, dict[str, Any]]:
    if not isinstance(parsed, dict):
        return 0, {"exact_ids": False, "counts": False, "formulas": False}
    actual = (
        {str(item).strip().upper() for item in parsed.get("location_mismatch_asset_ids", [])}
        if isinstance(parsed.get("location_mismatch_asset_ids"), list)
        else set()
    )
    exact_ids = actual == expected
    count_score = 0
    count_score += 3 if parsed.get("asset_rows") == 280 else 0
    count_score += 3 if parsed.get("movement_rows") == 430 else 0
    count_score += 4 if parsed.get("location_mismatch_count") == 30 else 0
    latest = _safe_formula(parsed.get("latest_timestamp_formula"))
    mismatch = _safe_formula(parsed.get("mismatch_flag_formula"))
    formula_text = re.sub(r"\s+", "", f"{latest or ''}{mismatch or ''}").upper()
    formulas = (
        all(token in formula_text for token in ("MAXIFS", "INDEX", "MATCH"))
        and ";" not in formula_text
        and "," in formula_text
    )
    return (80 if exact_ids else 0) + count_score + (10 if formulas else 0), {
        "exact_ids": exact_ids,
        "count_score": count_score,
        "formulas": formulas,
        "found": len(actual),
        "missing": sorted(expected - actual),
        "extra": sorted(actual - expected),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=600.0)
    parser.add_argument("--max-tokens", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=20260816)
    args = parser.parse_args()

    prompt, expected = _focused_prompt()
    base_client = OpenRouterClient()._build_client(timeout=args.timeout)
    client = base_client.with_options(timeout=args.timeout, max_retries=0)
    catalog = {item.id: item.model_dump() for item in client.models.list().data}

    def run(model: str) -> dict[str, Any]:
        supported = set(catalog[model].get("supported_parameters") or [])
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": "Проверяемая межфайловая сверка. Верни только итоговый JSON."},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": args.max_tokens,
        }
        if "temperature" in supported:
            kwargs["temperature"] = 0
        if "seed" in supported:
            kwargs["seed"] = args.seed
        if "response_format" in supported:
            kwargs["response_format"] = {"type": "json_object"}
        started = time.perf_counter()
        try:
            response = client.chat.completions.create(**kwargs)
            raw = _extract_completion_text(response)
            usage = response.usage.model_dump() if getattr(response, "usage", None) else None
            parsed = _parse_json(raw)
            error = None if parsed is not None and usage is not None else "invalid_json_or_missing_usage"
        except Exception as exc:  # noqa: BLE001
            raw, usage, parsed = "", None, None
            error = f"{type(exc).__name__}: {exc}"
        score, checks = _score(parsed, expected)
        return {
            "model": model,
            "score": score,
            "max_score": 100,
            "seconds": round(time.perf_counter() - started, 3),
            "usage": usage,
            "parsed": parsed,
            "raw": raw,
            "error": error,
            "checks": checks,
        }

    print(f"START models={len(args.models)} prompt_chars={len(prompt)}", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=len(args.models)) as pool:
        futures = [pool.submit(run, model) for model in args.models]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(
                f"RESULT {result['model']} {result['score']}/100 {result['seconds']}s "
                f"cost={(result.get('usage') or {}).get('cost')}",
                flush=True,
            )
    results.sort(key=lambda row: (-row["score"], row["seconds"]))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(
            {
                "generated_at": datetime.now().astimezone().isoformat(),
                "method": "focused_latest_movement_retest_ru",
                "prompt_chars": len(prompt),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"REPORT={args.report}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
