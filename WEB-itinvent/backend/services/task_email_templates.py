from __future__ import annotations

import html
import os
import re
from typing import Any, Callable


STATUS_LABELS = {
    "new": "Новое",
    "in_progress": "В работе",
    "review": "На проверке",
    "done": "Готово",
}

PRIORITY_LABELS = {
    "low": "Низкий",
    "normal": "Обычный",
    "high": "Высокий",
    "urgent": "Срочный",
}

BRAND_PRIMARY = "#1976d2"


def _read_env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or default).strip()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text if text else default


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def description_max_chars() -> int:
    raw = _read_env("TASK_EMAIL_DESCRIPTION_MAX_CHARS", "300")
    try:
        return max(80, min(2000, int(raw)))
    except (TypeError, ValueError):
        return 300


def preview_text(value: Any, *, limit: int | None = None) -> str:
    max_chars = int(limit or description_max_chars())
    text = re.sub(r"\s+", " ", _normalize_text(value)).strip()
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - 1)].rstrip() + "…"


def _status_label(status: Any) -> str:
    key = _normalize_text(status).lower()
    return STATUS_LABELS.get(key, key or "—")


def _priority_label(priority: Any) -> str:
    key = _normalize_text(priority, "normal").lower()
    return PRIORITY_LABELS.get(key, key or "Обычный")


def _person_name(task: dict[str, Any], prefix: str) -> str:
    full_name = _normalize_text(task.get(f"{prefix}_full_name"))
    username = _normalize_text(task.get(f"{prefix}_username"))
    return full_name or username or ""


def _has_controller(task: dict[str, Any]) -> bool:
    if _as_int(task.get("controller_user_id")) <= 0:
        return False
    return bool(_person_name(task, "controller"))


def _event_copy(event_type: str, *, notification_body: str = "") -> tuple[str, str, str]:
    normalized = _normalize_text(event_type).lower()
    if normalized == "task.assigned":
        return (
            "Вам назначена новая задача",
            "Откройте задачу в HUB-IT, ознакомьтесь с описанием и приступайте к выполнению.",
            f"HUB-IT: новая задача",
        )
    if normalized == "task.controller_assigned":
        return (
            "Вы назначены контролёром задачи",
            "Следите за ходом выполнения и проверьте результат, когда исполнитель отправит задачу на проверку.",
            "HUB-IT: вы контролёр задачи",
        )
    if normalized == "task.deadline_changed":
        return (
            "Изменён срок задачи",
            "Проверьте обновлённый срок и скорректируйте план работ при необходимости.",
            "HUB-IT: изменён срок задачи",
        )
    if normalized in {"task.submitted", "task.review_required"}:
        return (
            "Задача ждёт вашей проверки",
            "Исполнитель отправил задачу на проверку. Откройте карточку и примите решение.",
            "HUB-IT: задача ждёт проверки",
        )
    if normalized == "task.reviewed":
        detail = _normalize_text(notification_body) or "Задача проверена. Откройте карточку, чтобы посмотреть результат."
        return (
            "Результат проверки задачи",
            detail,
            "HUB-IT: результат проверки",
        )
    if normalized == "task.reopened":
        detail = _normalize_text(notification_body) or "Задача возвращена в работу. Проверьте обновлённые условия и приступайте к выполнению."
        return (
            "Задача возвращена в работу",
            detail,
            "HUB-IT: задача возвращена в работу",
        )
    if normalized == "task.deadline_soon":
        return (
            "Скоро истекает срок задачи",
            "Срок выполнения близко. Если нужно больше времени — обновите статус или согласуйте новый срок.",
            "HUB-IT: скоро срок задачи",
        )
    return (
        "Обновление по задаче",
        _normalize_text(notification_body) or "Есть новое событие по задаче в HUB-IT.",
        "HUB-IT: уведомление по задаче",
    )


def _build_field_rows(task: dict[str, Any], *, due_text: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = [
        ("Статус", _status_label(task.get("status"))),
        ("Исполнитель", _person_name(task, "assignee") or "—"),
    ]
    creator = _person_name(task, "created_by")
    if creator:
        rows.append(("Постановщик", creator))
    if _has_controller(task):
        rows.append(("Контролёр", _person_name(task, "controller")))
    rows.append(("Срок", due_text or "Без срока"))
    priority = _normalize_text(task.get("priority"), "normal").lower()
    if priority and priority != "normal":
        rows.append(("Приоритет", _priority_label(priority)))
    return rows


def _plain_field_block(rows: list[tuple[str, str]]) -> list[str]:
    return [f"{label}: {value}" for label, value in rows]


def _html_escape(value: Any) -> str:
    return html.escape(_normalize_text(value), quote=True)


def _render_html_shell(
    *,
    headline: str,
    intro: str,
    task_title: str,
    rows: list[tuple[str, str]],
    description: str,
    link: str,
    cta_label: str = "Открыть задачу",
) -> str:
    row_html = "".join(
        (
            "<tr>"
            f"<td style=\"padding:8px 12px 8px 0;color:#64748b;font-size:14px;white-space:nowrap;vertical-align:top;\">{_html_escape(label)}</td>"
            f"<td style=\"padding:8px 0;font-size:14px;color:#0f172a;vertical-align:top;\">{_html_escape(value)}</td>"
            "</tr>"
        )
        for label, value in rows
    )
    description_html = ""
    if description:
        description_html = (
            "<div style=\"margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;\">"
            "<div style=\"font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;\">Описание</div>"
            f"<div style=\"font-size:14px;line-height:1.55;color:#334155;\">{_html_escape(description)}</div>"
            "</div>"
        )
    button_html = ""
    link_html = ""
    if link:
        safe_link = _html_escape(link)
        button_html = (
            "<div style=\"margin-top:24px;text-align:center;\">"
            f"<a href=\"{safe_link}\" "
            f"style=\"display:inline-block;background:{BRAND_PRIMARY};color:#ffffff;text-decoration:none;"
            "font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;\">"
            f"{_html_escape(cta_label)}</a>"
            "</div>"
        )
        link_html = (
            "<div style=\"margin-top:12px;text-align:center;font-size:12px;line-height:1.5;color:#64748b;\">"
            "Если кнопка не открывается, перейдите по ссылке:<br>"
            f"<a href=\"{safe_link}\" style=\"color:{BRAND_PRIMARY};word-break:break-all;\">{safe_link}</a>"
            "</div>"
        )
    return (
        "<!DOCTYPE html><html><body style=\"margin:0;padding:0;background:#f5f7fa;\">"
        "<div style=\"max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;\">"
        "<div style=\"font-size:12px;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px;\">HUB-IT · Задачи</div>"
        f"<h1 style=\"margin:0 0 8px;font-size:22px;line-height:1.3;color:#0f172a;\">{_html_escape(headline)}</h1>"
        f"<p style=\"margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;\">{_html_escape(intro)}</p>"
        "<div style=\"background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;\">"
        f"<div style=\"font-size:18px;font-weight:700;line-height:1.35;color:#0f172a;margin-bottom:16px;\">{_html_escape(task_title)}</div>"
        f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse;\">{row_html}</table>"
        f"{description_html}"
        "</div>"
        f"{button_html}{link_html}"
        "<div style=\"margin-top:24px;font-size:12px;line-height:1.5;color:#94a3b8;\">Это автоматическое уведомление HUB-IT. Ответ на это письмо не обрабатывается.</div>"
        "</div></body></html>"
    )


def build_task_email_content(
    *,
    event_type: str,
    task: dict[str, Any],
    link: str,
    notification_title: str = "",
    notification_body: str = "",
    format_due: Callable[[Any], str] | None = None,
) -> tuple[str, str, str]:
    title_text = _normalize_text(task.get("title"), "Задача")
    due_text = format_due(task.get("due_at")) if format_due else _normalize_text(task.get("due_at"), "Без срока")
    headline, intro, subject_prefix = _event_copy(event_type, notification_body=notification_body)
    if _normalize_text(notification_title):
        headline = _normalize_text(notification_title)
    subject = f"{subject_prefix} — {title_text}"
    rows = _build_field_rows(task, due_text=due_text)
    description = preview_text(task.get("description"))

    text_lines = [
        headline,
        "",
        intro,
        "",
        f"Задача: {title_text}",
        *_plain_field_block(rows),
    ]
    if description:
        text_lines.extend(["", "Описание:", description])
    if link:
        text_lines.extend(["", "Открыть задачу:", link])
    text_lines.extend(["", "Это автоматическое уведомление HUB-IT."])
    body_text = "\n".join(text_lines)
    body_html = _render_html_shell(
        headline=headline,
        intro=intro,
        task_title=title_text,
        rows=rows,
        description=description,
        link=link,
    )
    return subject, body_text, body_html


def build_overdue_digest_email(
    *,
    tasks: list[dict[str, Any]],
    task_url: Callable[[Any], str],
    format_due: Callable[[Any], str],
    tasks_page_url: str = "",
) -> tuple[str, str, str]:
    count = len(tasks)
    subject = f"HUB-IT: просроченные задачи — {count}"
    headline = f"У вас {count} просроченных задач"
    intro = "Ниже список задач с истёкшим сроком. Откройте нужную карточку и обновите статус или согласуйте новый срок."

    text_lines = [headline, "", intro, ""]
    items_html: list[str] = []
    for index, task in enumerate(tasks[:10], start=1):
        title_text = _normalize_text(task.get("title"), "Задача")
        due_text = format_due(task.get("due_at"))
        link = task_url(task.get("id"))
        text_lines.append(f"{index}. {title_text}")
        text_lines.append(f"   Срок: {due_text}")
        if link:
            text_lines.append(f"   {link}")
        text_lines.append("")
        safe_link = _html_escape(link)
        items_html.append(
            "<div style=\"border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#ffffff;\">"
            f"<div style=\"font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;\">{index}. {_html_escape(title_text)}</div>"
            f"<div style=\"font-size:14px;color:#64748b;margin-bottom:12px;\">Срок: {_html_escape(due_text)}</div>"
            f"<a href=\"{safe_link}\" style=\"display:inline-block;background:{BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;\">Открыть задачу</a>"
            "</div>"
        )
    if count > 10:
        tail = f"И ещё задач: {count - 10}. Откройте раздел задач в HUB-IT."
        text_lines.extend([tail, ""])
    text_lines.append("Это дневной digest. Отдельные письма по каждой просроченной задаче не отправляются.")
    body_text = "\n".join(text_lines)

    tail_html = ""
    if count > 10:
        tail_html = (
            f"<p style=\"margin:0 0 16px;font-size:14px;color:#475569;\">И ещё задач: {count - 10}. "
            "Откройте раздел задач в HUB-IT.</p>"
        )
    page_link_html = ""
    if tasks_page_url:
        safe_page = _html_escape(tasks_page_url)
        page_link_html = (
            "<div style=\"margin-top:8px;text-align:center;\">"
            f"<a href=\"{safe_page}\" style=\"color:{BRAND_PRIMARY};font-size:14px;font-weight:700;text-decoration:none;\">"
            "Открыть все задачи</a></div>"
        )
    body_html = (
        "<!DOCTYPE html><html><body style=\"margin:0;padding:0;background:#f5f7fa;\">"
        "<div style=\"max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;\">"
        "<div style=\"font-size:12px;font-weight:700;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px;\">HUB-IT · Задачи</div>"
        f"<h1 style=\"margin:0 0 8px;font-size:22px;line-height:1.3;color:#0f172a;\">{_html_escape(headline)}</h1>"
        f"<p style=\"margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;\">{_html_escape(intro)}</p>"
        f"{''.join(items_html)}{tail_html}{page_link_html}"
        "<div style=\"margin-top:24px;font-size:12px;line-height:1.5;color:#94a3b8;\">Это дневной digest HUB-IT. Ответ на это письмо не обрабатывается.</div>"
        "</div></body></html>"
    )
    return subject, body_text, body_html
