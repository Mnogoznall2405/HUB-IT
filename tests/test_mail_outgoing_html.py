from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

outgoing_html = importlib.import_module("backend.services.mail_outgoing_html")
mail_module = importlib.import_module("backend.services.mail_service")


def test_outgoing_html_plain_text_escapes_and_preserves_line_breaks():
    assert outgoing_html.plain_text_to_html("<hello>\r\nworld") == "&lt;hello&gt;<br>world"


def test_outgoing_html_module_keeps_mail_service_compatibility_aliases():
    body = '<p style="color:#fff">New</p><div class="quoted-mail"><p>Old</p></div>'
    signature = "<p>Signature</p>"

    direct = outgoing_html.build_outgoing_html_body(body, signature, prefer_signature_before_quote=True)
    via_service = mail_module._build_outgoing_html_body(body, signature, prefer_signature_before_quote=True)

    assert direct == via_service
    assert 'data-mail-signature="true"' in direct
    assert direct.index("Signature") < direct.index("Old")
    assert "color:#000000;" in direct


def test_extract_reply_new_body_html_drops_quoted_block():
    body = outgoing_html.build_outgoing_html_body(
        '<p>Согласен</p><div class="quoted-mail"><p>Старое письмо</p></div>',
        "<p>Подпись</p>",
        prefer_signature_before_quote=True,
    )
    new_body = outgoing_html.extract_reply_new_body_html(body)
    assert "Согласен" in new_body
    assert "Подпись" in new_body
    assert "Старое письмо" not in new_body


def test_build_outgoing_html_preserves_native_formatted_quote_marker():
    body = outgoing_html.build_outgoing_html_body(
        '<div data-mail-native-body="true"><p>New reply<br>Second line</p></div>'
        '<div data-mail-native-quote="true" data-mail-quoted-history="true">'
        '<div class="quoted-mail"><blockquote><strong>Formatted original</strong></blockquote></div>'
        "</div>",
        "<p>Signature</p>",
        prefer_signature_before_quote=True,
    )

    assert 'data-mail-native-quote="true"' in body
    assert "<strong>Formatted original</strong>" in body
    assert body.index("Signature") < body.index("Formatted original")


def test_extract_reply_new_body_html_keeps_plain_reply_without_quote():
    body = outgoing_html.build_outgoing_html_body("<p>Только ответ</p>", "")
    assert "Только ответ" in outgoing_html.extract_reply_new_body_html(body)
