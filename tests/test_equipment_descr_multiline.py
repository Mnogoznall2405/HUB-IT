import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries  # noqa: E402


def test_normalize_legacy_multiline_storage_converts_lf_to_crlf():
    assert queries._normalize_legacy_multiline_storage("строка1\nстрока2") == "строка1\r\nстрока2"


def test_normalize_legacy_multiline_storage_is_idempotent_for_crlf():
    text = "строка1\r\nстрока2"
    assert queries._normalize_legacy_multiline_storage(text) == text


def test_legacy_items_descr_value_preserves_multiline_crlf():
    value = queries._legacy_items_descr_value("строка1\nстрока2")
    assert value is not None
    assert "\r\n" in value
    assert value.splitlines() == ["строка1", "строка2"]
