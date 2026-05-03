from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")


def _service():
    return mail_module.MailService.__new__(mail_module.MailService)


def _exchange_protocol():
    try:
        from exchangelib.protocol import BaseProtocol, NoVerifyHTTPAdapter
    except Exception as exc:  # pragma: no cover - depends on optional test env package
        pytest.skip(f"exchangelib is not available: {exc}")
    return BaseProtocol, NoVerifyHTTPAdapter


def _reset_runtime_adapter_state(base_protocol, original_adapter):
    base_protocol.HTTP_ADAPTER_CLS = original_adapter
    mail_module._EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS = None
    mail_module._EXCHANGE_HTTP_ADAPTER_SIGNATURE = None


def test_mail_service_verifies_tls_by_default(monkeypatch):
    monkeypatch.delenv("MAIL_VERIFY_TLS", raising=False)
    monkeypatch.delenv("MAIL_TLS_CA_BUNDLE", raising=False)
    monkeypatch.delenv("MAIL_CA_BUNDLE", raising=False)

    assert _service().verify_tls is True


def test_mail_service_uses_no_verify_adapter_only_inside_explicit_insecure_context(monkeypatch):
    BaseProtocol, NoVerifyHTTPAdapter = _exchange_protocol()
    original_adapter = BaseProtocol.HTTP_ADAPTER_CLS
    monkeypatch.setenv("MAIL_VERIFY_TLS", "0")
    monkeypatch.delenv("MAIL_TLS_CA_BUNDLE", raising=False)

    try:
        with _service()._exchange_protocol_context():
            assert BaseProtocol.HTTP_ADAPTER_CLS is NoVerifyHTTPAdapter
        assert BaseProtocol.HTTP_ADAPTER_CLS is original_adapter
    finally:
        _reset_runtime_adapter_state(BaseProtocol, original_adapter)


def test_mail_service_uses_configured_ca_bundle_adapter_temporarily(monkeypatch, temp_dir):
    BaseProtocol, NoVerifyHTTPAdapter = _exchange_protocol()
    original_adapter = BaseProtocol.HTTP_ADAPTER_CLS
    ca_bundle = Path(temp_dir) / "exchange-ca.pem"
    ca_bundle.write_text(
        "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("MAIL_VERIFY_TLS", "1")
    monkeypatch.setenv("MAIL_TLS_CA_BUNDLE", str(ca_bundle))

    try:
        with _service()._exchange_protocol_context():
            adapter_cls = BaseProtocol.HTTP_ADAPTER_CLS
            assert adapter_cls is not original_adapter
            assert adapter_cls is not NoVerifyHTTPAdapter
            assert adapter_cls.__name__ == "MailCABundleHTTPAdapter"
        assert BaseProtocol.HTTP_ADAPTER_CLS is original_adapter
    finally:
        _reset_runtime_adapter_state(BaseProtocol, original_adapter)


def test_mail_service_rejects_missing_ca_bundle(monkeypatch, temp_dir):
    monkeypatch.setenv("MAIL_VERIFY_TLS", "1")
    monkeypatch.setenv("MAIL_TLS_CA_BUNDLE", str(Path(temp_dir) / "missing-ca.pem"))

    with pytest.raises(mail_module.MailServiceError, match="MAIL_TLS_CA_BUNDLE"):
        with _service()._exchange_protocol_context():
            pass


def test_mail_service_applies_no_verify_adapter_for_lazy_runtime_requests(monkeypatch):
    BaseProtocol, NoVerifyHTTPAdapter = _exchange_protocol()
    original_adapter = BaseProtocol.HTTP_ADAPTER_CLS
    monkeypatch.setenv("MAIL_VERIFY_TLS", "0")
    monkeypatch.delenv("MAIL_TLS_CA_BUNDLE", raising=False)
    warning_calls = []
    monkeypatch.setattr(
        mail_module.warnings,
        "filterwarnings",
        lambda *args, **kwargs: warning_calls.append((args, kwargs)),
    )

    try:
        _service()._configure_exchange_http_adapter_for_runtime()

        assert BaseProtocol.HTTP_ADAPTER_CLS is NoVerifyHTTPAdapter
        assert warning_calls
        assert warning_calls[-1][0] == ("ignore",)
        assert warning_calls[-1][1]["category"].__name__ == "InsecureRequestWarning"
    finally:
        _reset_runtime_adapter_state(BaseProtocol, original_adapter)


def test_mail_service_can_restore_default_runtime_adapter(monkeypatch):
    BaseProtocol, NoVerifyHTTPAdapter = _exchange_protocol()
    original_adapter = BaseProtocol.HTTP_ADAPTER_CLS
    monkeypatch.setenv("MAIL_VERIFY_TLS", "0")
    monkeypatch.delenv("MAIL_TLS_CA_BUNDLE", raising=False)

    try:
        _service()._configure_exchange_http_adapter_for_runtime()
        assert BaseProtocol.HTTP_ADAPTER_CLS is NoVerifyHTTPAdapter

        monkeypatch.setenv("MAIL_VERIFY_TLS", "1")
        _service()._configure_exchange_http_adapter_for_runtime()

        assert BaseProtocol.HTTP_ADAPTER_CLS is original_adapter
    finally:
        _reset_runtime_adapter_state(BaseProtocol, original_adapter)
