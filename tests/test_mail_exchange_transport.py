from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

transport = importlib.import_module("backend.services.mail_exchange_transport")
mail_module = importlib.import_module("backend.services.mail_service")


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
