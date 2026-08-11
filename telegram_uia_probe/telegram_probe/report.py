"""Build HTML timeline report from events.jsonl."""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .chat_detector import detect_chat
from .message_parser import extract_dialogue
from .models import ChatVisit, TelegramSession, utc_now_iso
from .uia_tree import UiDump

logger = logging.getLogger(__name__)


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _duration_seconds(start: str | None, end: str | None) -> float | None:
    a = _parse_ts(start)
    b = _parse_ts(end)
    if not a or not b:
        return None
    return max(0.0, (b - a).total_seconds())


def _fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h} ч {m} мин {s} с"
    if m:
        return f"{m} мин {s} с"
    return f"{s} с"


def _strip_marks(text: str) -> str:
    return (
        (text or "")
        .replace("\u200e", "")
        .replace("\u200f", "")
        .replace("⁨", "")
        .replace("⁩", "")
        .strip()
    )


def _chat_from_event(ev: dict[str, Any]) -> tuple[str, float, str]:
    """Prefer stored chat_name; repair older events that mislabeled chrome as chat."""
    title = _strip_marks(str(ev.get("window_title") or ""))
    stored = ev.get("chat_name")
    conf = float(ev.get("chat_confidence") or 0.0)
    note = str(ev.get("chat_detection_note") or "")

    repaired = detect_chat(title, UiDump())
    chrome = {
        "главное меню",
        "поиск",
        "звонок",
        "папки",
        "чаты",
        "информация",
        "меню чата",
    }
    stored_norm = _strip_marks(str(stored or "")).lower()
    if repaired.chat_name and (
        not stored
        or stored_norm in chrome
        or (repaired.confidence >= 0.9 and stored_norm != repaired.chat_name.lower())
    ):
        return repaired.chat_name, repaired.confidence, repaired.note + " (восстановлено при отчёте)"
    if stored and stored_norm in chrome:
        return "Список чатов / главный экран", 0.3, "Открыт список чатов, не конкретный диалог."
    if stored:
        return str(stored), conf, note
    if repaired.chat_name:
        return repaired.chat_name, repaired.confidence, repaired.note
    return "Неизвестно / не определено", 0.0, note or "чат не определён"


def _messages_from_event(ev: dict[str, Any], chat_name: str | None) -> tuple[list[dict[str, Any]], str]:
    stored = list(ev.get("messages") or [])
    note = str(ev.get("dialogue_note") or "")
    # HistoryInner snapshots are authoritative — never re-parse/reorder them.
    if stored and "HistoryInner" in note:
        return stored, note or f"Сообщений в событии: {len(stored)}"
    if stored and not _looks_scrambled(stored):
        return stored, note or f"Сообщений в событии: {len(stored)}"
    # Rebuild in appearance order from visible_text bubbles.
    dialogue = extract_dialogue(
        visible_text=list(ev.get("visible_text") or []),
        chat_name=chat_name,
    )
    if dialogue.messages:
        rebuilt_note = dialogue.note
        if stored and _looks_scrambled(stored):
            rebuilt_note += " Порядок восстановлен из visible_text (старый снимок был перемешан)."
        return dialogue.to_dicts(), rebuilt_note
    if stored:
        return stored, note or f"Сообщений в событии: {len(stored)}"
    return [], dialogue.note


def _looks_scrambled(messages: list[dict[str, Any]]) -> bool:
    """Heuristic: long run of only outgoing then only incoming = broken order."""
    if len(messages) < 8:
        return False
    dirs = [str(m.get("direction") or "") for m in messages]
    # Find first incoming and last outgoing
    try:
        first_in = next(i for i, d in enumerate(dirs) if d == "incoming")
        last_out = max(i for i, d in enumerate(dirs) if d == "outgoing")
    except (StopIteration, ValueError):
        return False
    # If almost all outs come before almost all ins — scrambled
    outs_before = sum(1 for d in dirs[:first_in] if d == "outgoing")
    ins_after = sum(1 for d in dirs[last_out + 1 :] if d == "incoming")
    return outs_before >= 5 and ins_after >= 5 and first_in > len(messages) * 0.35


def _merge_messages(
    dst: list[dict[str, Any]],
    src: list[dict[str, Any]],
    *,
    src_note: str = "",
) -> list[dict[str, Any]]:
    """Prefer the latest HistoryInner window; do not glue old wrong snapshots in front."""
    if not src:
        return dst[:400]
    if not dst:
        return list(src)[:400]
    # Authoritative ordered dump from HistoryInner replaces previous content.
    if "HistoryInner" in (src_note or ""):
        return list(src)[:400]
    if len(src) >= len(dst) and not _looks_scrambled(src):
        return list(src)[:400]
    # Otherwise keep dst if it is better, else src
    if _looks_scrambled(dst) and not _looks_scrambled(src):
        return list(src)[:400]
    return list(src)[:400]


def build_sessions(events: list[dict[str, Any]]) -> list[TelegramSession]:
    sessions: list[TelegramSession] = []
    current: TelegramSession | None = None
    current_visit: ChatVisit | None = None

    def close_visit(ended_at: str | None) -> None:
        nonlocal current_visit
        if current is None or current_visit is None:
            return
        current_visit.ended_at = ended_at
        current_visit.duration_seconds = _duration_seconds(
            current_visit.started_at, ended_at
        )
        current.chat_visits.append(current_visit)
        current_visit = None

    def close_session(ended_at: str | None) -> None:
        nonlocal current
        close_visit(ended_at)
        if current is None:
            return
        current.ended_at = ended_at
        current.duration_seconds = _duration_seconds(current.started_at, ended_at)
        sessions.append(current)
        current = None

    def apply_event_to_visit(ev: dict[str, Any], *, force_new: bool) -> None:
        nonlocal current_visit
        assert current is not None
        chat_label, conf, note = _chat_from_event(ev)
        files = list(ev.get("file_names") or [])
        texts = list(ev.get("visible_text") or [])[:80]
        shot = ev.get("screenshot_path")
        msgs, dlg_note = _messages_from_event(ev, chat_label)

        changed_chat = (
            current_visit is None
            or force_new
            or (current_visit.chat_name != chat_label and chat_label != "Неизвестно / не определено")
        )
        if changed_chat and current_visit is not None:
            close_visit(ev.get("timestamp"))

        if current_visit is None:
            current_visit = ChatVisit(
                chat_name=chat_label,
                confidence=conf,
                started_at=ev.get("timestamp") or "",
                file_names=files,
                visible_text_sample=texts,
                messages=list(msgs),
                dialogue_note=dlg_note,
                screenshots=[shot] if shot else [],
                events_count=1,
                detection_note=note,
            )
            return

        current_visit.events_count += 1
        if conf > current_visit.confidence:
            current_visit.confidence = conf
            current_visit.chat_name = chat_label
            current_visit.detection_note = note
        for f in files:
            if f not in current_visit.file_names:
                current_visit.file_names.append(f)
        for t in texts:
            if t not in current_visit.visible_text_sample:
                current_visit.visible_text_sample.append(t)
        current_visit.messages = _merge_messages(
            current_visit.messages,
            msgs,
            src_note=dlg_note,
        )
        if dlg_note and (
            "HistoryInner" in dlg_note
            or not current_visit.dialogue_note
            or len(msgs) >= len(current_visit.messages)
        ):
            current_visit.dialogue_note = dlg_note
        if shot and shot not in current_visit.screenshots:
            current_visit.screenshots.append(shot)
        current_visit.visible_text_sample = current_visit.visible_text_sample[:80]
        current_visit.file_names = current_visit.file_names[:80]

    for ev in events:
        et = ev.get("event_type")
        ts = ev.get("timestamp")
        if et == "telegram_activated":
            if current is not None:
                close_session(ts)
            current = TelegramSession(
                session_id=str(ev.get("session_id") or f"sess_{len(sessions)+1}"),
                started_at=ts or "",
                pid=ev.get("pid"),
            )
            title = ev.get("window_title") or ""
            if title:
                current.window_titles.append(title)
            apply_event_to_visit(ev, force_new=True)
            continue

        if current is None:
            if et in {"ui_snapshot", "chat_changed", "telegram_deactivated"}:
                current = TelegramSession(
                    session_id=str(ev.get("session_id") or f"sess_{len(sessions)+1}"),
                    started_at=ts or "",
                    pid=ev.get("pid"),
                )
            else:
                continue

        title = ev.get("window_title") or ""
        if title and title not in current.window_titles:
            current.window_titles.append(title)

        if et == "chat_changed":
            apply_event_to_visit(ev, force_new=True)
        elif et in {"ui_snapshot", "telegram_activated"}:
            apply_event_to_visit(ev, force_new=False)
        elif et == "telegram_deactivated":
            close_session(ts)

    if current is not None:
        last_ts = events[-1].get("timestamp") if events else current.started_at
        close_session(last_ts)

    return sessions


def _is_redundant_media_text(text: str, media: str, media_path: str) -> bool:
    if not media_path:
        return False
    t = (text or "").strip().lower()
    m = (media or "").strip().lower()
    if not t:
        return True
    if m and t == m:
        return True
    if t.startswith("фотография") or t.startswith("видео") or t.startswith("gif"):
        # Caption may follow the label; keep only if longer than the label alone.
        if m and t == m:
            return True
        if len(t) <= len(m) + 2:
            return True
        # "Фотография, 720×1280 caption" → keep caption after label
        return False
    return False


def _render_media_block(m: dict[str, Any]) -> str:
    media_path = str(m.get("media_path") or "").replace("\\", "/")
    media_label = str(m.get("media") or "")
    kind = str(m.get("media_kind") or "").lower()
    if media_path:
        safe = html.escape(media_path)
        if kind in {"jpeg", "png", "webp", "gif"} or media_path.lower().endswith(
            (".jpeg", ".jpg", ".png", ".webp", ".gif")
        ):
            return (
                f"<div class='media-file'>"
                f"<a href=\"{safe}\" target=\"_blank\" rel=\"noopener\">"
                f"<img src=\"{safe}\" alt=\"{html.escape(media_label or 'media')}\" loading=\"lazy\"/>"
                f"</a></div>"
            )
        if kind == "mp4" or media_path.lower().endswith(".mp4"):
            return (
                f"<div class='media-file'>"
                f"<video controls preload=\"metadata\" src=\"{safe}\"></video>"
                f"</div>"
            )
        return (
            f"<div class='media'><a href=\"{safe}\" target=\"_blank\" rel=\"noopener\">"
            f"{html.escape(media_label or media_path)}</a></div>"
        )
    if media_label:
        return f"<div class='media'>{html.escape(media_label)}</div>"
    return ""


def _render_dialogue(messages: list[dict[str, Any]], note: str) -> str:
    if not messages:
        return (
            f"<p class='muted'>{html.escape(note or 'Диалог не извлечён из UIA.')}</p>"
        )
    bubbles = []
    for idx, m in enumerate(messages, 1):
        direction = str(m.get("direction") or "unknown")
        css = "out" if direction == "outgoing" else "in"
        who = html.escape(str(m.get("sender") or ("Я" if css == "out" else "Собеседник")))
        raw_text = str(m.get("text") or "")
        media_label = str(m.get("media") or "")
        media_path = str(m.get("media_path") or "")
        # Prefer caption after "Фотография, WxH "
        display_text = raw_text
        if media_path and media_label and raw_text.startswith(media_label):
            display_text = raw_text[len(media_label) :].strip()
        if _is_redundant_media_text(display_text, media_label, media_path):
            display_text = ""
        text = html.escape(display_text)
        time_s = html.escape(str(m.get("time") or ""))
        quote = html.escape(str(m.get("quote") or ""))
        reply_to = html.escape(str(m.get("reply_to") or ""))
        arrow = "→ я" if css == "out" else "← собеседник"
        meta_bits = [f"#{idx}", arrow]
        if time_s:
            meta_bits.append(time_s)
        if media_path and m.get("media_match"):
            meta_bits.append(html.escape(str(m.get("media_match"))))
        quote_html = ""
        if quote or reply_to:
            quote_html = (
                f"<div class='quote'>Ответ для {reply_to or '—'}: "
                f"<em>{quote or '…'}</em></div>"
            )
        media_html = _render_media_block(m)
        text_html = f"<div class=\"text\">{text}</div>" if text else ""
        bubbles.append(
            f"""
            <div class="bubble {css}">
              <div class="who">{who}</div>
              {quote_html}
              {media_html}
              {text_html}
              <div class="when">{' · '.join(meta_bits)}</div>
            </div>
            """
        )
    return (
        f"<p class='note'>{html.escape(note)}</p>"
        f"<div class='dialogue'>{''.join(bubbles)}</div>"
    )


def render_html_report(
    events: list[dict[str, Any]],
    output_path: Path,
    meta: dict[str, Any] | None = None,
    *,
    last_session_only: bool = False,
    chat_state: Any | None = None,
) -> Path:
    """
    Long-run report: dialogue index from chat_state/chats/*.jsonl first,
    then per-chat dialogues, then compact activity log.
    """
    del last_session_only  # legacy flag; long-run report is chat-centric
    meta = meta or {}
    user = html.escape(str(meta.get("windows_user") or "—"))
    computer = html.escape(str(meta.get("computer_name") or "—"))
    generated = html.escape(str(meta.get("generated_at") or utc_now_iso()))

    chats_payload = _collect_chats_for_report(events, chat_state)
    index_rows = []
    chat_sections = []
    total_msgs = 0
    for chat in chats_payload:
        total_msgs += len(chat["messages"])
        cid = html.escape(chat["chat_id"])
        name = html.escape(chat["chat_name"])
        kind = str(chat.get("chat_kind") or "unknown")
        kind_ru = {
            "group": "группа",
            "channel": "канал",
            "private": "личный",
            "unknown": "—",
        }.get(kind, kind)
        preview = html.escape((chat.get("last_message_preview") or "—")[:120])
        index_rows.append(
            f"""
            <tr>
              <td><a href="#chat-{cid}">{name}</a></td>
              <td>{html.escape(kind_ru)}</td>
              <td>{len(chat["messages"])}</td>
              <td>{html.escape(chat.get("first_message_time") or "—")}</td>
              <td>{html.escape(chat.get("last_message_time") or "—")}</td>
              <td>{preview}</td>
            </tr>
            """
        )
        shots = "".join(
            f'<a href="{html.escape(s)}" target="_blank" rel="noopener">'
            f'<img src="{html.escape(s)}" alt="screenshot" loading="lazy"/></a>'
            for s in (chat.get("screenshots") or [])
            if s
        ) or "<p class='muted'>снимков нет</p>"
        dialogue_html = _render_dialogue(
            chat["messages"],
            chat.get("note")
            or f"Сообщений в хранилище чата: {len(chat['messages'])}",
        )
        chat_sections.append(
            f"""
            <section class="panel chat-card" id="chat-{cid}">
              <h3>{html.escape(kind_ru.capitalize() if kind_ru != "—" else "Чат")}: {name}</h3>
              <div class="meta">
                <span>тип: {html.escape(kind_ru)}</span>
                <span>сообщений: {len(chat["messages"])}</span>
                <span>первое: {html.escape(chat.get("first_message_time") or "—")}</span>
                <span>последнее: {html.escape(chat.get("last_message_time") or "—")}</span>
                <span>увиден: {html.escape(chat.get("first_seen") or "—")} → {html.escape(chat.get("last_seen") or "—")}</span>
              </div>
              <section>
                <h5>Диалог</h5>
                {dialogue_html}
              </section>
              <section>
                <h5>Снимки</h5>
                <div class="shots">{shots}</div>
              </section>
            </section>
            """
        )

    activity_rows = []
    for ev in events:
        et = str(ev.get("event_type") or "")
        if et not in {
            "telegram_activated",
            "telegram_deactivated",
            "chat_opened",
            "messages_delta",
        }:
            # keep legacy event types visible too
            pass
        ts = html.escape(str(ev.get("timestamp") or ""))
        chat = html.escape(str(ev.get("chat_name") or "—"))
        n = len(ev.get("messages") or [])
        note = html.escape(str(ev.get("dialogue_note") or ev.get("chat_detection_note") or "")[:180])
        activity_rows.append(
            f"<tr><td>{ts}</td><td><code>{html.escape(et)}</code></td>"
            f"<td>{chat}</td><td>{n}</td><td class='note'>{note}</td></tr>"
        )

    if not chats_payload and not events:
        empty_notice = (
            "<div class='banner warn'>Данных нет. Запустите probe, откройте Telegram "
            "и переключайте чаты, затем Ctrl+C.</div>"
        )
    else:
        empty_notice = (
            "<div class='banner info'>Долгий режим: новый чат сохраняется один раз "
            "(видимая HistoryInner-история), дальше только дельты новых сообщений. "
            "Пока Telegram не в фокусе — ничего не пишется. "
            "UIA не отдаёт архив за пределами видимого окна.</div>"
        )

    doc = f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Telegram UIA Probe — отчёт</title>
  <style>
    :root {{
      --bg: #f3f5f7; --card: #ffffff; --ink: #18212b; --muted: #5b6b7c;
      --line: #d7dee7; --accent: #1f6feb; --out: #d7f5e3; --in: #eef2f7;
      --warn-bg: #fff6df; --info-bg: #eaf2ff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font: 15px/1.45 "Segoe UI", Tahoma, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 500px at 10% -10%, #d9e8ff 0%, transparent 55%),
        radial-gradient(900px 400px at 100% 0%, #e7f6ef 0%, transparent 50%),
        var(--bg);
    }}
    header.app, main {{ max-width: 1200px; margin: 0 auto; padding: 24px 32px; }}
    header.app {{ padding-bottom: 8px; }}
    header.app h1 {{ margin: 0 0 8px; font-size: 1.8rem; letter-spacing: -0.02em; }}
    header.app p {{ margin: 4px 0; color: var(--muted); }}
    .banner {{
      padding: 12px 14px; border-radius: 10px; margin: 12px 0 20px;
      border: 1px solid var(--line);
    }}
    .banner.warn {{ background: var(--warn-bg); }}
    .banner.info {{ background: var(--info-bg); }}
    .panel {{
      background: var(--card); border: 1px solid var(--line); border-radius: 14px;
      padding: 18px 20px; margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(24, 33, 43, 0.04);
    }}
    .meta {{
      display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--muted);
      font-size: 0.92rem; margin-bottom: 8px;
    }}
    .note {{ color: var(--muted); font-size: 0.92rem; }}
    .muted {{ color: var(--muted); }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; }}
    th, td {{
      border-bottom: 1px solid var(--line); text-align: left;
      padding: 8px 6px; vertical-align: top;
    }}
    th {{ color: var(--muted); font-weight: 600; }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .dialogue {{ display: flex; flex-direction: column; gap: 8px; margin-top: 8px; max-width: 820px; }}
    .bubble {{
      max-width: min(680px, 92%); padding: 10px 12px; border-radius: 12px;
      border: 1px solid var(--line);
    }}
    .bubble.out {{ align-self: flex-end; background: var(--out); }}
    .bubble.in {{ align-self: flex-start; background: var(--in); }}
    .bubble .who {{ font-size: 0.8rem; font-weight: 650; margin-bottom: 4px; color: var(--muted); }}
    .bubble .text {{ white-space: pre-wrap; word-break: break-word; }}
    .bubble .when {{ margin-top: 6px; font-size: 0.78rem; color: var(--muted); }}
    .bubble .quote {{
      font-size: 0.85rem; border-left: 3px solid var(--accent);
      padding-left: 8px; margin-bottom: 6px; color: var(--muted);
    }}
    .bubble .media {{ font-size: 0.85rem; margin-bottom: 4px; color: var(--accent); }}
    .bubble .media-file {{ margin: 4px 0 6px; }}
    .bubble .media-file img, .bubble .media-file video {{
      display: block; max-width: min(360px, 100%); max-height: 420px;
      width: auto; height: auto; border-radius: 10px;
      border: 1px solid var(--line); background: #111;
    }}
    .shots {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }}
    .shots img {{
      width: 220px; max-width: 100%; height: auto; border-radius: 8px;
      border: 1px solid var(--line); background: #111;
    }}
    h5 {{
      margin: 0 0 4px; font-size: 0.85rem; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--muted);
    }}
    code {{ font-family: Consolas, "Courier New", monospace; }}
    @media (max-width: 800px) {{
      header.app, main {{ padding-left: 16px; padding-right: 16px; }}
    }}
  </style>
</head>
<body>
  <header class="app">
    <h1>Telegram Desktop — UI Automation Probe</h1>
    <p>Пользователь Windows: <strong>{user}</strong> · компьютер: <strong>{computer}</strong></p>
    <p>Сформировано: {generated} · диалогов: {len(chats_payload)} · сообщений: {total_msgs} · событий: {len(events)}</p>
    <p>Режим: long-run, только чтение UI (без кликов). Медиа — из локального media cache Telegram (без экспорта сессии).</p>
  </header>
  <main>
    {empty_notice}
    <section class="panel">
      <h2>Диалоги</h2>
      <p class="note">Список чатов (личные / группы / каналы), по которым есть сохранённая история.</p>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Чат</th>
              <th>Тип</th>
              <th>Сообщ.</th>
              <th>Первое</th>
              <th>Последнее</th>
              <th>Превью</th>
            </tr>
          </thead>
          <tbody>
            {''.join(index_rows) or '<tr><td colspan="6" class="muted">диалогов пока нет</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    <h2>Переписка</h2>
    {''.join(chat_sections) or '<p class="muted">Нет сохранённых чатов.</p>'}

    <section class="panel">
      <h2>Активность (компактно)</h2>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Тип</th>
              <th>Чат</th>
              <th>+Msgs</th>
              <th>Заметка</th>
            </tr>
          </thead>
          <tbody>
            {''.join(activity_rows) or '<tr><td colspan="5" class="muted">пусто</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>
"""
    output_path.write_text(doc, encoding="utf-8")
    logger.info("HTML report written: %s", output_path)
    return output_path


def _collect_chats_for_report(
    events: list[dict[str, Any]],
    chat_state: Any | None,
) -> list[dict[str, Any]]:
    """Prefer chat_state store; fallback to reconstructing from events."""
    if chat_state is not None:
        from .message_filter import filter_messages_for_chat

        out: list[dict[str, Any]] = []
        for rec in chat_state.list_chats():
            kind = getattr(rec, "chat_kind", None) or "unknown"
            msgs = filter_messages_for_chat(
                rec.chat_name,
                chat_state.load_chat_messages(rec.chat_id),
                kind=kind,
            )
            kind_ru = {
                "group": "группа",
                "channel": "канал",
                "private": "личный",
                "unknown": "чат",
            }.get(kind, kind)
            out.append(
                {
                    "chat_id": rec.chat_id,
                    "chat_name": rec.chat_name,
                    "chat_kind": kind,
                    "messages": msgs,
                    "screenshots": list(rec.screenshots),
                    "first_seen": rec.first_seen,
                    "last_seen": rec.last_seen,
                    "first_message_time": (msgs[0].get("time") if msgs else "")
                    or rec.first_message_time,
                    "last_message_time": (msgs[-1].get("time") if msgs else "")
                    or rec.last_message_time,
                    "last_message_preview": (
                        str(msgs[-1].get("text") or "")[:160] if msgs else ""
                    )
                    or rec.last_message_preview,
                    "note": (
                        f"Источник: chats/{rec.chat_id}.jsonl · тип: {kind_ru}"
                    ),
                }
            )
        if out:
            return out

    # Fallback: merge messages from events by chat name
    from .chat_state import message_key, safe_chat_id

    buckets: dict[str, dict[str, Any]] = {}
    for ev in events:
        chat_name = ev.get("chat_name")
        if not chat_name:
            continue
        chat_id = safe_chat_id(str(chat_name))
        bucket = buckets.setdefault(
            chat_id,
            {
                "chat_id": chat_id,
                "chat_name": str(chat_name),
                "messages": [],
                "screenshots": [],
                "first_seen": ev.get("timestamp") or "",
                "last_seen": ev.get("timestamp") or "",
                "keys": set(),
            },
        )
        bucket["last_seen"] = ev.get("timestamp") or bucket["last_seen"]
        shot = ev.get("screenshot_path")
        if shot and shot not in bucket["screenshots"]:
            bucket["screenshots"].append(shot)
        for m in ev.get("messages") or []:
            key = message_key(m)
            if key in bucket["keys"]:
                continue
            bucket["keys"].add(key)
            bucket["messages"].append(m)

    out2: list[dict[str, Any]] = []
    for bucket in buckets.values():
        msgs = bucket["messages"]
        out2.append(
            {
                "chat_id": bucket["chat_id"],
                "chat_name": bucket["chat_name"],
                "messages": msgs,
                "screenshots": bucket["screenshots"],
                "first_seen": bucket["first_seen"],
                "last_seen": bucket["last_seen"],
                "first_message_time": msgs[0].get("time") if msgs else "",
                "last_message_time": msgs[-1].get("time") if msgs else "",
                "last_message_preview": (str(msgs[-1].get("text") or "")[:160] if msgs else ""),
                "note": "Собрано из events.jsonl (state.json отсутствует)",
            }
        )
    out2.sort(key=lambda c: c.get("last_seen") or "", reverse=True)
    return out2


def regenerate_from_output(
    output_dir: Path,
    *,
    last_session_only: bool = False,
    sanitize: bool = True,
    attach_media: bool = True,
    media_passcode: str = "",
) -> Path:
    from .chat_state import ChatStateStore
    from .media_cache import MediaLibrary, attach_media_to_chat_files
    from .storage import OutputStore

    store = OutputStore(output_dir)
    chat_state = ChatStateStore(output_dir)
    if sanitize and chat_state.list_chats():
        removed = chat_state.sanitize_stored_chats()
        total = sum(removed.values())
        if total:
            logger.info("Sanitized chats, removed foreign/status msgs: %s", removed)
    if attach_media:
        library = MediaLibrary(
            output_dir,
            passcode=media_passcode,
            enabled=True,
        )
        try:
            linked = attach_media_to_chat_files(chat_state, library)
            if linked:
                logger.info("Backfilled media on %d message(s)", linked)
        except Exception as exc:  # noqa: BLE001
            logger.warning("media backfill failed: %s", exc)
    events = store.load_events()
    meta_user = ""
    meta_host = ""
    if events:
        meta_user = str(events[0].get("windows_user") or "")
        meta_host = str(events[0].get("computer_name") or "")
    return render_html_report(
        events,
        store.report_path,
        meta={
            "windows_user": meta_user,
            "computer_name": meta_host,
            "generated_at": utc_now_iso(),
        },
        last_session_only=last_session_only,
        chat_state=chat_state,
    )
