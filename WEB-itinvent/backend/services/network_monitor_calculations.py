"""Pure calculations shared by stored history, alerting and chart queries."""
from __future__ import annotations

import math
from datetime import datetime, timezone

SUM_SUFFIXES = ("_bytes", "_seconds", "_packets", "_checks")


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def timestamp(value) -> datetime | None:
    if not value:
        return None
    try:
        return utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except (ValueError, TypeError):
        return None


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def interface_rates(previous: dict, current: dict, now: datetime, uptime: int | None, previous_uptime: int | None) -> dict:
    result = {key: None for key in ("rx_bps", "tx_bps", "rx_bytes", "tx_bytes", "rx_seconds", "tx_seconds", "rx_errors_pps", "tx_errors_pps", "rx_discards_pps", "tx_discards_pps")}
    previous_at = timestamp(previous.get("counter_checked_at") or previous.get("checked_at"))
    elapsed = (utc(now) - previous_at).total_seconds() if previous_at else 0
    reset = previous.get("snmp_index") != current.get("snmp_index")
    reset |= previous_uptime is None or uptime is None or uptime < previous_uptime
    reset |= current.get("oper") != 1 or previous.get("oper") != 1
    before_disc, after_disc = previous.get("discontinuity"), current.get("discontinuity")
    reset |= before_disc is not None and after_disc is not None and before_disc != after_disc
    if reset or not 1 <= elapsed <= 180:
        return result
    fields = (("rx_octets", "rx_bps", 8), ("tx_octets", "tx_bps", 8),
              ("rx_errors", "rx_errors_pps", 1), ("tx_errors", "tx_errors_pps", 1),
              ("rx_discards", "rx_discards_pps", 1), ("tx_discards", "tx_discards_pps", 1))
    # A decrease in any counter invalidates the interval; never draw reset spikes.
    if any(number(previous.get(source)) is not None and number(current.get(source)) is not None
           and current[source] < previous[source] for source, _, _ in fields):
        return result
    for source, destination, multiplier in fields:
        before, after = number(previous.get(source)), number(current.get(source))
        if before is not None and after is not None:
            value = (after - before) * multiplier / elapsed
            speed = number(current.get("speed_bps"))
            result[destination] = None if destination in {"rx_bps", "tx_bps"} and speed and value > speed * 1.1 else value
    for direction in ("rx", "tx"):
        if result[f"{direction}_bps"] is not None:
            result[f"{direction}_bytes"] = current[f"{direction}_octets"] - previous[f"{direction}_octets"]
            result[f"{direction}_seconds"] = elapsed
    return result


def aggregate_values(existing: dict, values: dict, duration: float = 60) -> dict:
    result = {key: dict(value) for key, value in existing.items()}
    for key, value in values.items():
        if key.startswith("_"):
            continue
        value = number(value)
        if value is None:
            continue
        prior = result.get(key, {})
        weight = 1 if key.endswith(SUM_SUFFIXES) else duration
        result[key] = {"sum": prior.get("sum", 0) + value * weight,
                       "weight": prior.get("weight", 0) + weight,
                       "min": min(prior.get("min", value), value),
                       "max": max(prior.get("max", value), value),
                       "count": prior.get("count", 0) + 1}
    return result


def chart_values(values: dict, aggregated: bool) -> dict:
    if not aggregated:
        return values
    result = {}
    for key, stats in values.items():
        result[key] = stats["sum"] if key.endswith(SUM_SUFFIXES) else (stats["sum"] / stats["weight"] if stats.get("weight") else None)
        result[key + "_min"] = stats.get("min")
        result[key + "_max"] = stats.get("max")
    return result


def merge_aggregates(existing: dict, values: dict) -> dict:
    result = {key: dict(value) for key, value in existing.items()}
    for key, stats in values.items():
        before = result.get(key)
        result[key] = dict(stats) if before is None else {
            "sum": before["sum"] + stats["sum"], "weight": before["weight"] + stats["weight"],
            "min": min(before["min"], stats["min"]), "max": max(before["max"], stats["max"]),
            "count": before["count"] + stats["count"]}
    return result
