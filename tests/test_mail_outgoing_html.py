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
