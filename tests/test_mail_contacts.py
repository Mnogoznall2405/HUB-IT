from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")


def _no_results_error():
    from exchangelib.errors import ErrorNameResolutionNoResults

    return ErrorNameResolutionNoResults("No results")


def _service_with_local_fallback(monkeypatch):
    service = mail_module.MailService.__new__(mail_module.MailService)
    monkeypatch.setattr(
        service,
        "_resolve_mail_profile",
        lambda **_kwargs: {
            "email": "user@example.test",
            "login": "user@example.test",
            "password": "password",
        },
    )
    monkeypatch.setattr(
        service,
        "_search_local_user_contacts",
        lambda query: [{"name": "Local User", "email": "local@example.test", "source": "itinvent_users"}],
    )
    return service


def test_search_contacts_treats_gal_no_results_item_as_empty_result(monkeypatch, caplog):
    service = _service_with_local_fallback(monkeypatch)
    account = SimpleNamespace(
        protocol=SimpleNamespace(
            resolve_names=lambda **_kwargs: [_no_results_error()],
        )
    )
    monkeypatch.setattr(service, "_create_account", lambda **_kwargs: account)

    with caplog.at_level(logging.WARNING):
        rows = service.search_contacts(user_id=38, q="query")

    assert rows == [{"name": "Local User", "email": "local@example.test", "source": "itinvent_users"}]
    assert "Error searching contacts in GAL" not in caplog.text


def test_search_contacts_treats_raised_gal_no_results_as_empty_result(monkeypatch, caplog):
    service = _service_with_local_fallback(monkeypatch)

    def _raise_no_results(**_kwargs):
        raise _no_results_error()

    account = SimpleNamespace(protocol=SimpleNamespace(resolve_names=_raise_no_results))
    monkeypatch.setattr(service, "_create_account", lambda **_kwargs: account)

    with caplog.at_level(logging.WARNING):
        rows = service.search_contacts(user_id=38, q="query")

    assert rows == [{"name": "Local User", "email": "local@example.test", "source": "itinvent_users"}]
    assert "Error searching contacts in GAL" not in caplog.text


def test_search_contacts_primes_version_before_resolve_names(monkeypatch):
    # exchangelib ResolveNames reads protocol.config.version via _version_hint;
    # a fresh account has it None ('NoneType'.api_version crash) until the lazy
    # version guess runs — the service must prime account.version first.
    service = _service_with_local_fallback(monkeypatch)

    class FakeProtocol:
        def __init__(self):
            self.version = None
            self.seen_versions = []

        def resolve_names(self, **_kwargs):
            self.seen_versions.append(self.version)
            return [SimpleNamespace(email_address="gal@example.test", name="Gal User")]

    class FakeAccount:
        def __init__(self):
            self.protocol = FakeProtocol()

        @property
        def version(self):
            if self.protocol.version is None:
                self.protocol.version = object()  # lazy guess populates config.version
            return self.protocol.version

    account = FakeAccount()
    monkeypatch.setattr(service, "_create_account", lambda **_kwargs: account)

    rows = service.search_contacts(user_id=38, q="query")

    assert account.protocol.seen_versions == [account.protocol.version]
    assert account.protocol.seen_versions[0] is not None
    assert rows == [{"name": "Gal User", "email": "gal@example.test", "source": "exchange_gal"}]
