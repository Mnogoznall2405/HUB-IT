from backend.chat.folder_unread import (
    add_system_folder_unread,
    conversation_search_title,
    empty_system_folder_unread_counts,
)


def test_system_folder_unread_follows_native_tab_rules():
    counts = empty_system_folder_unread_counts()
    add_system_folder_unread(counts, kind="direct", unread_count=2)
    add_system_folder_unread(counts, kind="ai", unread_count=5)
    add_system_folder_unread(counts, kind="group", unread_count=3)
    add_system_folder_unread(counts, kind="group", task_id="task-1", unread_count=1)
    add_system_folder_unread(counts, kind="direct", is_archived=True, unread_count=4)
    add_system_folder_unread(counts, kind="task", unread_count=7)

    assert counts == {
        "personal": 7,
        "groups": 4,
        "tasks": 8,
        "archived": 4,
    }


def test_conversation_search_title_uses_kind_fallback():
    assert conversation_search_title(type("Conv", (), {"title": "Склад", "kind": "group"})()) == "Склад"
    assert conversation_search_title(type("Conv", (), {"title": "", "kind": "direct"})()) == "Личный чат"
