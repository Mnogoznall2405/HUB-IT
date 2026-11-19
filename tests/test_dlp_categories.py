"""Server-side DLP category rules: domain suffixes, precedence and the
company-specific B2B/corporate additions driven by real visit telemetry."""
from __future__ import annotations

import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent.parent / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.dlp_categories import (  # noqa: E402
    classify_domain,
    classify_visit,
    domain_from_url,
)


def test_b2b_suppliers_are_work():
    for domain in (
        "etm.ru",
        "wps.etm.ru",
        "chipdip.ru",
        "dkc.ru",
        "dkcmarket.ru",
        "iek.ru",
        "cable.ru",
        "komus.ru",
        "xcom-shop.ru",
        "promrukav.ru",
        "ssd.ru",
        "products.rubezh.ru",
    ):
        assert classify_domain(domain) == "work", domain


def test_corporate_and_reference_services_are_work():
    for domain in (
        "corporate.psbank.ru",
        "tinko.ru",
        "checko.ru",
        "www2.checko.ru",
        "rusprofile.ru",
        "consultant.ru",
        "internet-law.ru",
        "kad.arbitr.ru",
        "edu.rosmintrud.ru",
        "ru-ibe.tlintegration.ru",
        "docs.yandex.ru",
        "tools.pdf24.org",
    ):
        assert classify_domain(domain) == "work", domain


def test_personal_marketplaces_are_shopping():
    for domain in (
        "drom.ru",
        "auto.drom.ru",
        "cian.ru",
        "spb.cian.ru",
        "volzhskij.domclick.ru",
        "farpost.ru",
        "sutochno.ru",
        "aeroflot.ru",
        "ticket.rzd.ru",
        "autoopt.ru",
        "autopiter.ru",
        "72.freshauto.ru",
        "sima-land.ru",
        "perekrestok.ru",
    ):
        assert classify_domain(domain) == "shopping", domain


def test_geo_and_media_rules():
    assert classify_domain("wikimapia.org") == "maps"
    assert classify_domain("ventusky.com") == "maps"
    assert classify_domain("e1.ru") == "news"
    assert classify_domain("ixbt.com") == "news"
    assert classify_domain("pari.ru") == "entertainment"
    assert classify_domain("mm.anwap.media") == "entertainment"
    assert classify_domain("google.ru") == "search"
    assert classify_domain("yandex.by") == "search"


def test_longest_suffix_still_wins_over_parents():
    # news.mail.ru outranks generic mail.ru (regression guard).
    assert classify_domain("news.mail.ru") == "news"
    assert classify_domain("mail.ru") == "mail"
    # New specific host beats its shopping parent.
    assert classify_domain("auto.drom.ru") == "shopping"
    # No accidental parent matches: checko/rusprofile do not leak into .ru hosts.
    assert classify_domain("example-checko.ru") == "other"


def test_classify_visit_prefers_domain_then_title():
    assert classify_visit(domain="etm.ru", title="Видео") == "work"
    assert classify_visit(domain="unknown-host.xyz", title="Контур.Экстерн") == "work"
    assert classify_visit(domain="", title="", url="https://corporate.psbank.ru/x") == "work"
    # Retail PSB pages stay non-work — only the corporate portal is mapped.
    assert classify_domain("corp.psbank.ru") == "other"
    assert domain_from_url("file:///C:/docs/a.pdf") == "localhost"
    assert classify_visit(domain="wikipedia.org", title="Справочная статья") == "other"
