from __future__ import annotations

from backend.services.task_email_templates import (
    build_overdue_digest_email,
    build_task_email_content,
)


def _base_task(**overrides):
    payload = {
        "id": "task-1",
        "title": "Проверить сервер",
        "status": "new",
        "priority": "normal",
        "description": "Нужно проверить доступность сервиса и обновить статус в HUB-IT.",
        "assignee_full_name": "Иван Исполнитель",
        "assignee_username": "ivan",
        "created_by_full_name": "Пётр Постановщик",
        "created_by_username": "petr",
        "controller_user_id": 0,
        "controller_full_name": "",
        "controller_username": "",
        "due_at": "2026-06-25T12:00:00+00:00",
    }
    payload.update(overrides)
    return payload


def test_task_email_hides_controller_when_not_assigned():
    subject, body_text, body_html = build_task_email_content(
        event_type="task.assigned",
        task=_base_task(),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        format_due=lambda _: "25.06.2026 15:00",
    )

    assert "Контролёр" not in body_text
    assert "Контролёр" not in body_html
    assert "Постановщик" in body_text
    assert "Пётр Постановщик" in body_html
    assert subject.endswith("Проверить сервер")


def test_task_email_shows_controller_when_assigned():
    _, body_text, body_html = build_task_email_content(
        event_type="task.assigned",
        task=_base_task(
            controller_user_id=7,
            controller_full_name="Анна Контролёр",
            controller_username="anna",
        ),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        format_due=lambda _: "25.06.2026 15:00",
    )

    assert "Контролёр: Анна Контролёр" in body_text
    assert "Анна Контролёр" in body_html


def test_task_email_shows_priority_only_when_not_normal():
    _, body_text_normal, body_html_normal = build_task_email_content(
        event_type="task.assigned",
        task=_base_task(priority="normal"),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        format_due=lambda _: "25.06.2026 15:00",
    )
    _, body_text_high, body_html_high = build_task_email_content(
        event_type="task.assigned",
        task=_base_task(priority="high"),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        format_due=lambda _: "25.06.2026 15:00",
    )

    assert "Приоритет" not in body_text_normal
    assert "Приоритет" not in body_html_normal
    assert "Приоритет: Высокий" in body_text_high
    assert "Высокий" in body_html_high


def test_task_email_reopened_uses_notification_body_and_due():
    _, body_text, body_html = build_task_email_content(
        event_type="task.reopened",
        task=_base_task(status="in_progress", due_at="2026-08-15T16:00:00+00:00"),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        notification_body="Проверить сервер: возвращено в работу. Новый срок: 15.08.2026 19:00",
        format_due=lambda _: "15.08.2026 19:00",
    )

    assert "возвращено в работу" in body_text.lower()
    assert "15.08.2026 19:00" in body_text
    assert "Задача возвращена в работу" in body_html
    assert "15.08.2026 19:00" in body_html


def test_task_email_contains_clickable_link_and_button():
    _, body_text, body_html = build_task_email_content(
        event_type="task.assigned",
        task=_base_task(),
        link="https://hubit.zsgp.ru/tasks?task=task-1",
        format_due=lambda _: "25.06.2026 15:00",
    )

    assert "https://hubit.zsgp.ru/tasks?task=task-1" in body_text
    assert 'href="https://hubit.zsgp.ru/tasks?task=task-1"' in body_html
    assert "Открыть задачу" in body_html


def test_overdue_digest_renders_multiple_task_links():
    tasks = [
        _base_task(id="task-1", title="Задача 1"),
        _base_task(id="task-2", title="Задача 2"),
    ]
    subject, body_text, body_html = build_overdue_digest_email(
        tasks=tasks,
        task_url=lambda task_id: f"https://hubit.zsgp.ru/tasks?task={task_id}",
        format_due=lambda _: "20.06.2026 10:00",
        tasks_page_url="https://hubit.zsgp.ru/tasks",
    )

    assert subject.startswith("HUB-IT:")
    assert "2" in subject
    assert "task-1" in body_text
    assert "task-2" in body_text
    assert 'href="https://hubit.zsgp.ru/tasks?task=task-1"' in body_html
    assert 'href="https://hubit.zsgp.ru/tasks?task=task-2"' in body_html
    assert "Открыть все задачи" in body_html
