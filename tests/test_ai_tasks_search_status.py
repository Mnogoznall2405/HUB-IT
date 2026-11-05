from backend.ai_chat.tools.office import _task_status_filters


def test_open_status_words_expand_to_every_unfinished_status():
    # Регрессия: ИИ передавал «открытые», а Hub фильтрует по точному статусу — ответ «0 задач».
    for word in ("open", "Открытые", "active", "незавершённые"):
        assert _task_status_filters(word) == ["new", "in_progress", "review"]


def test_russian_status_names_map_to_hub_statuses_and_empty_means_any():
    assert _task_status_filters("в работе") == ["in_progress"]
    assert _task_status_filters("Закрытые") == ["done"]
    assert _task_status_filters("review") == ["review"]
    assert _task_status_filters("") == [""]
