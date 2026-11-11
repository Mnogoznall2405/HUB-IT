"""Messenger profiles for the shared desktop UIA probe (Telegram / MAX)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MessengerProfile:
    key: str
    display_name: str
    process_names: frozenset[str]
    probe_path: str
    channel: str
    egress_prefix: str
    runtime_dirname: str
    log_filename: str
    history_list_names: frozenset[str]
    history_class_needles: tuple[str, ...]
    event_prefix: str
    media_cache_default: bool
    ignore_title_exact: frozenset[str]


TELEGRAM = MessengerProfile(
    key="telegram",
    display_name="Telegram",
    process_names=frozenset({"telegram.exe", "telegram"}),
    probe_path="telegram-probe",
    channel="telegram",
    egress_prefix="tg",
    runtime_dirname="TelegramProbe",
    log_filename="telegram_probe.log",
    history_list_names=frozenset({"сообщения", "messages"}),
    # Prefer HistoryInner; HistoryWidget is only a shell (compose chrome + scroll).
    history_class_needles=("historyinner",),
    event_prefix="telegram",
    media_cache_default=True,
    ignore_title_exact=frozenset(
        {
            "telegram",
            "telegram desktop",
        }
    ),
)

MAX = MessengerProfile(
    key="max",
    display_name="MAX",
    process_names=frozenset(
        {
            "max.exe",
            "max",
            "max messenger.exe",
            "oneme.exe",
        }
    ),
    probe_path="max-probe",
    channel="max",
    egress_prefix="max",
    runtime_dirname="MaxProbe",
    log_filename="max_probe.log",
    # Desktop MAX UIA labels vary; keep broad heuristics until dump_uia on a live host.
    history_list_names=frozenset(
        {
            "сообщения",
            "messages",
            "чат",
            "chat",
            "история",
            "history",
        }
    ),
    history_class_needles=(
        # Prefer the list itself, not the outer HistoryPanel (header + list).
        "historylistview",
        "historymessagedelegate",
        "messagetextitem",
        "historypanel",
        "chatbackground",
        "historyinner",
        "historywidget",
        "messagelist",
        "chathistory",
        "conversation",
        "messageview",
        "datesectiondelegate",
    ),
    event_prefix="max",
    media_cache_default=False,
    ignore_title_exact=frozenset(
        {
            "max",
            "max messenger",
            "веб-версия max",
        }
    ),
)

_PROFILES = {
    TELEGRAM.key: TELEGRAM,
    MAX.key: MAX,
}


def get_profile(key: str | None) -> MessengerProfile:
    name = str(key or "telegram").strip().lower()
    if name in {"tg", "telegramdesktop"}:
        name = "telegram"
    if name not in _PROFILES:
        raise ValueError(f"Unknown messenger probe profile: {key!r}")
    return _PROFILES[name]
