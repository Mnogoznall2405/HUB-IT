from __future__ import annotations

import importlib
import json
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_observability import mail_observability_snapshot, reset_mail_observability

transport = importlib.import_module("backend.services.mail_exchange_transport")
mail_module = importlib.import_module("backend.services.mail_service")

EWS_ENDPOINT = "https://mail.example/EWS/Exchange.asmx"


def _exchange_config(*, username="DOMAIN\\mailuser", password="secret", endpoint=EWS_ENDPOINT):
    from exchangelib import Configuration, Credentials, NTLM

    return Configuration(
        service_endpoint=endpoint,
        credentials=Credentials(username=username, password=password),
        auth_type=NTLM,
    )


@pytest.fixture
def isolated_protocol_cache():
    from exchangelib.protocol import CachingProtocol

    original = dict(CachingProtocol._protocol_cache)
    CachingProtocol._protocol_cache.clear()
    try:
        yield CachingProtocol._protocol_cache
    finally:
        CachingProtocol._protocol_cache.clear()
        CachingProtocol._protocol_cache.update(original)



def test_exchange_transport_resolves_ca_bundle_and_rejects_missing_file(temp_dir):
    ca_bundle = Path(temp_dir) / "exchange-ca.pem"
    ca_bundle.write_text("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", encoding="utf-8")

    assert transport.resolve_tls_ca_bundle(str(ca_bundle)) == str(ca_bundle)

    with pytest.raises(transport.ExchangeTransportError, match="MAIL_TLS_CA_BUNDLE"):
        transport.resolve_tls_ca_bundle(str(Path(temp_dir) / "missing.pem"))


def test_exchange_transport_selects_default_ca_and_no_verify_adapters(temp_dir):
    ca_bundle = Path(temp_dir) / "exchange-ca.pem"
    ca_bundle.write_text("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", encoding="utf-8")

    assert transport.resolve_exchange_http_adapter(verify_tls=True, ca_bundle="") == (("default",), None)

    signature, adapter_cls = transport.resolve_exchange_http_adapter(verify_tls=True, ca_bundle=str(ca_bundle))
    assert signature == ("ca_bundle", str(ca_bundle))
    assert adapter_cls.__name__ == "MailCABundleHTTPAdapter"

    no_verify_signature, no_verify_adapter = transport.resolve_exchange_http_adapter(verify_tls=False, ca_bundle="")
    if no_verify_adapter is None:
        assert no_verify_signature == ("default",)
    else:
        assert no_verify_signature == ("no_verify",)


def test_exchange_transport_suppresses_insecure_warning_with_supplied_warnings_api():
    calls = []
    fake_warnings = SimpleNamespace(filterwarnings=lambda *args, **kwargs: calls.append((args, kwargs)))

    transport.suppress_insecure_request_warning(warnings_api=fake_warnings)

    assert calls
    assert calls[-1][0] == ("ignore",)
    assert calls[-1][1]["category"].__name__ == "InsecureRequestWarning"


def test_mail_service_transport_wrappers_keep_mail_service_errors(monkeypatch, temp_dir):
    service = mail_module.MailService.__new__(mail_module.MailService)
    monkeypatch.setenv("MAIL_VERIFY_TLS", "1")
    monkeypatch.setenv("MAIL_TLS_CA_BUNDLE", str(Path(temp_dir) / "missing.pem"))

    with pytest.raises(mail_module.MailServiceError, match="MAIL_TLS_CA_BUNDLE"):
        service._resolve_exchange_http_adapter()


def test_protocol_cache_key_is_equal_for_same_endpoint_and_credentials():
    first = _exchange_config()
    second = _exchange_config()
    assert transport.protocol_cache_key(first) == transport.protocol_cache_key(second)


def test_protocol_cache_key_changes_when_password_or_endpoint_changes():
    baseline = transport.protocol_cache_key(_exchange_config())
    other_password = transport.protocol_cache_key(_exchange_config(password="other-secret"))
    other_endpoint = transport.protocol_cache_key(
        _exchange_config(endpoint="https://mail-b.example/EWS/Exchange.asmx"),
    )
    assert baseline != other_password
    assert baseline != other_endpoint


def test_inspect_protocol_cache_hit_without_live_handshake(isolated_protocol_cache):
    config = _exchange_config()
    miss = transport.inspect_protocol_cache(config)
    assert miss["available"] is True
    assert miss["hit"] is False
    assert miss["errored"] is False
    assert "credentials" not in miss
    assert "service_endpoint" not in miss

    isolated_protocol_cache[transport.protocol_cache_key(config)] = (object(), None)
    hit = transport.inspect_protocol_cache(config)
    assert hit["hit"] is True
    assert hit["size"] >= 1
    assert hit["errored"] is False

    isolated_protocol_cache[transport.protocol_cache_key(config)] = (RuntimeError("transport"), None)
    errored = transport.inspect_protocol_cache(config)
    assert errored["hit"] is False
    assert errored["errored"] is True


def test_create_exchange_account_records_protocol_cache_without_account_pool(
    monkeypatch,
    isolated_protocol_cache,
):
    import exchangelib

    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    reset_mail_observability()

    class DummyAccount:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(exchangelib, "Account", DummyAccount)
    account = transport.create_exchange_account(
        email="user@example.com",
        login="DOMAIN\\mailuser",
        password="secret",
        ews_url=EWS_ENDPOINT,
        exchange_host="mail.example",
        protocol_context=nullcontext(),
    )
    assert isinstance(account, DummyAccount)
    snapshot = mail_observability_snapshot()
    dumped = json.dumps(snapshot)
    assert snapshot["protocol_cache"]["misses"] == 1
    assert snapshot["protocol_cache"]["hits"] == 0
    assert "mailbox_id" not in dumped
    assert "DOMAIN\\" not in dumped
    assert "secret" not in dumped
    assert "@example.com" not in dumped

    isolated_protocol_cache[transport.protocol_cache_key(_exchange_config())] = (object(), None)
    transport.create_exchange_account(
        email="user@example.com",
        login="DOMAIN\\mailuser",
        password="secret",
        ews_url=EWS_ENDPOINT,
        exchange_host="mail.example",
        protocol_context=nullcontext(),
    )
    after = mail_observability_snapshot()["protocol_cache"]
    assert after["hits"] == 1
    assert after["misses"] == 1
    assert after["hit_rate"] == 0.5
    assert after["last_size"] >= 1
