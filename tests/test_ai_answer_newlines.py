from backend.ai_chat.service import _unescape_literal_newlines


def test_double_escaped_reply_gets_real_line_breaks_but_normal_markdown_is_untouched():
    # Регрессия: модель вернула ответ одной строкой с литеральными "\n" — таблица и заголовки не рендерились.
    assert _unescape_literal_newlines("## A\n\n| x | y |\n|---|---|") == "## A\n\n| x | y |\n|---|---|"
    assert _unescape_literal_newlines("line1\nпуть C:\new") == "line1\nпуть C:\new"
