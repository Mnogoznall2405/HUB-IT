from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.utils.client_geo import (
    normalize_country_code,
    resolve_client_geo,
    should_show_vpn_hint,
)


def test_normalize_country_code_rejects_placeholders():
    assert normalize_country_code("ru") == "RU"
    assert normalize_country_code("xx") is None
    assert normalize_country_code("T1") is None
    assert normalize_country_code("Russia") is None


def test_vpn_hint_only_for_known_non_russian_external_clients():
    assert should_show_vpn_hint(network_zone="internal", country_code="DE") is False
    assert should_show_vpn_hint(network_zone="external", country_code="RU") is False
    assert should_show_vpn_hint(network_zone="external", country_code=None) is False
    assert should_show_vpn_hint(network_zone="external", country_code="DE") is True


def test_resolve_client_geo_prefers_country_header():
    request = SimpleNamespace(headers={"cf-ipcountry": "nl"})
    geo = resolve_client_geo(
        request=request,
        client_ip="8.8.8.8",
        network_zone="external",
        lookup_country=lambda ip: "US",
    )
    assert geo.country_code == "NL"
    assert geo.show_vpn_hint is True
    assert geo.source == "header"


def test_resolve_client_geo_skips_hint_for_internal_zone():
    geo = resolve_client_geo(
        request=SimpleNamespace(headers={}),
        client_ip="10.1.2.3",
        network_zone="internal",
        lookup_country=lambda ip: "DE",
    )
    assert geo.show_vpn_hint is False
    assert geo.country_code == "RU"
