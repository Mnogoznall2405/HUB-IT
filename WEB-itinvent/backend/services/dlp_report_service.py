"""Build a single current DLP report on the server (no version history)."""
from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from backend.services import fs_egress_store_service as store


def _esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def _fmt_ts(ts: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(ts or "—")


def _short_text(value: Any, *, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


CHANNEL_LABELS = {
    "usb": "USB",
    "network": "Сеть",
    "telegram": "Telegram",
    "deleted": "Удаление",
}

DIR_LABELS = {
    "outgoing": "→",
    "incoming": "←",
    "out": "→",
    "in": "←",
}


def build_live_dlp_report_html(*, computer_name: str) -> str:
    """One current snapshot: host page with Files / Telegram tabs; TG dialogs as sub-tabs."""
    host = str(computer_name or "").strip()
    events = store.list_events(computer_name=host, limit=300)
    chats = store.list_telegram_chats(computer_name=host, limit=200)
    generated = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")

    event_rows = []
    for row in events:
        if row.get("channel") == "deleted":
            continue
        event_rows.append(
            "<tr>"
            f"<td>{_esc(_fmt_ts(row.get('ts')))}</td>"
            f"<td>{_esc(row.get('windows_user'))}</td>"
            f"<td>{_esc(row.get('file_name'))}</td>"
            f"<td>{_esc(row.get('dest_path'))}</td>"
            f"<td>{_esc(CHANNEL_LABELS.get(row.get('channel'), row.get('channel')))}</td>"
            "</tr>"
        )
    file_count = len(event_rows)

    dialog_buttons: List[str] = []
    dialog_panels: List[str] = []
    for idx, chat in enumerate(chats):
        chat_id = str(chat.get("chat_id") or chat.get("chat_name") or idx)
        tab_id = f"dialog-{idx}"
        panel_id = f"dialog-panel-{idx}"
        messages = chat.get("messages") if isinstance(chat.get("messages"), list) else []
        tail = messages[-60:]
        msgs_html = []
        for msg in tail:
            if not isinstance(msg, dict):
                continue
            raw_dir = str(msg.get("direction") or "").strip().lower()
            direction = DIR_LABELS.get(raw_dir, raw_dir[:1] or "·")
            text = _esc(_short_text(msg.get("text") or msg.get("media") or ""))
            when = _esc(msg.get("time") or msg.get("timestamp") or "")
            side = "out" if "out" in raw_dir else ("in" if "in" in raw_dir else "other")
            msgs_html.append(
                f"<div class='msg {side}'>"
                f"<span class='dir'>{_esc(direction)}</span>"
                f"<span class='when'>{when}</span>"
                f"<span class='txt'>{text}</span>"
                "</div>"
            )
        label = _esc(_short_text(chat.get("chat_name") or chat_id, limit=28))
        dialog_buttons.append(
            f"<button type='button' class='dialog-btn{' active' if idx == 0 else ''}' "
            f"data-dialog='{tab_id}'>{label}<span class='count'>{len(messages)}</span></button>"
        )
        dialog_panels.append(
            f"<div class='dialog-panel{' active' if idx == 0 else ''}' id='{panel_id}' data-dialog='{tab_id}'>"
            f"<p class='meta'>user={_esc(chat.get('windows_user'))} · всего {len(messages)}, "
            f"показаны последние {len(tail)}</p>"
            f"<div class='msgs'>{''.join(msgs_html) or '<p class=\"meta\">Сообщений нет</p>'}</div>"
            "</div>"
        )

    telegram_body = (
        "<div class='dialogs'>"
        f"<div class='dialog-list'>{''.join(dialog_buttons)}</div>"
        f"{''.join(dialog_panels)}"
        "</div>"
        if dialog_buttons
        else '<p class="meta">Чатов пока нет</p>'
    )

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>DLP · {_esc(host)}</title>
<style>
body {{ font-family: Segoe UI, sans-serif; margin: 20px; color: #122; }}
h1 {{ margin: 0.4em 0 0.2em; }}
.meta {{ color: #556; font-size: 12px; margin: 0 0 8px; }}
.badge {{ display:inline-block; background:#e8f0ff; padding:2px 8px; border-radius:6px; }}
.main-tabs {{ display:flex; gap:6px; margin:14px 0 10px; }}
.main-btn {{ border:1px solid #c9d3e2; background:#fff; border-radius:8px; padding:7px 12px; font-size:13px; cursor:pointer; }}
.main-btn.active {{ background:#245; color:#fff; border-color:#245; }}
.main-panel {{ display:none; }}
.main-panel.active {{ display:block; }}
table {{ border-collapse: collapse; width: 100%; margin: 8px 0 0; }}
th,td {{ border: 1px solid #d7dde7; padding: 5px 7px; font-size: 12px; vertical-align: top; }}
th {{ background: #eef3fa; text-align: left; }}
.dialogs {{ border: 1px solid #d7dde7; border-radius: 8px; overflow: hidden; }}
.dialog-list {{ display:flex; flex-wrap:wrap; gap:4px; padding:8px; background:#f4f7fb; border-bottom:1px solid #d7dde7; }}
.dialog-btn {{ border:1px solid #c9d3e2; background:#fff; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
.dialog-btn.active {{ background:#245; color:#fff; border-color:#245; }}
.dialog-btn .count {{ margin-left:6px; opacity:0.75; font-size:11px; }}
.dialog-panel {{ display:none; padding:10px 12px 12px; }}
.dialog-panel.active {{ display:block; }}
.msgs {{ max-height: 62vh; overflow:auto; }}
.msg {{ display:flex; gap:6px; align-items:baseline; font-size:11px; line-height:1.35; margin:2px 0; padding:2px 0; border-bottom:1px solid #f0f3f7; }}
.msg .dir {{ flex:0 0 14px; font-weight:700; color:#245; }}
.msg.out .dir {{ color:#0b6; }}
.msg.in .dir {{ color:#06c; }}
.msg .when {{ flex:0 0 auto; color:#789; min-width:42px; }}
.msg .txt {{ flex:1 1 auto; word-break:break-word; }}
</style>
</head>
<body>
<h1>DLP · {_esc(host)}</h1>
<p class="meta">Сформировано на сервере: {_esc(generated)} · <span class="badge">актуальный снимок</span></p>

<div class="main-tabs">
  <button type="button" class="main-btn active" data-main="files">Файлы ({file_count})</button>
  <button type="button" class="main-btn" data-main="telegram">Telegram ({len(chats)})</button>
</div>

<section class="main-panel active" data-main="files">
  <p class="meta">Список залогированных файлов, покинувших ПК</p>
  <table>
  <thead><tr><th>Время</th><th>Пользователь</th><th>Файл</th><th>Куда</th><th>Канал</th></tr></thead>
  <tbody>
  {''.join(event_rows) or '<tr><td colspan="5">Событий нет</td></tr>'}
  </tbody>
  </table>
</section>

<section class="main-panel" data-main="telegram">
  <p class="meta">Диалоги на одной странице — каждый на своей вкладке</p>
  {telegram_body}
</section>

<script>
(function () {{
  function bind(groupBtn, groupPanel, attr) {{
    var buttons = document.querySelectorAll(groupBtn);
    var panels = document.querySelectorAll(groupPanel);
    buttons.forEach(function (btn) {{
      btn.addEventListener('click', function () {{
        var id = btn.getAttribute(attr);
        buttons.forEach(function (b) {{ b.classList.toggle('active', b === btn); }});
        panels.forEach(function (p) {{ p.classList.toggle('active', p.getAttribute(attr) === id); }});
      }});
    }});
  }}
  bind('.main-btn', '.main-panel', 'data-main');
  bind('.dialog-btn', '.dialog-panel', 'data-dialog');
}})();
</script>
</body>
</html>
"""


def get_current_report_html(computer_name: str) -> Dict[str, Any]:
    host = str(computer_name or "").strip()
    if not host:
        raise ValueError("computer_name required")
    html_doc = build_live_dlp_report_html(computer_name=host)
    try:
        store.get_egress_store().save_report(
            computer_name=host,
            windows_user="",
            html=html_doc,
        )
    except Exception:
        pass
    return {
        "computer_name": host,
        "html": html_doc,
        "mode": "live_server",
    }
