"""Read-only ONLYOFFICE preview: viewer config, provider routing, conversion mocks."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from backend.services import mail_attachment_preview_service as preview_service
from backend.services import onlyoffice_service as oo
from backend.services.onlyoffice_conversion_service import (
    OnlyOfficeConversionError,
    convert_document_to_pdf,
)


SECRET = "test-viewer-secret"


@pytest.fixture
def _onlyoffice_env(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", SECRET)
    monkeypatch.setenv("ONLYOFFICE_INTERNAL_URL", "http://ds.internal:8080")
    monkeypatch.setenv("ONLYOFFICE_APP_BASE_URL", "https://hub.example")


def _settings():
    return oo.load_settings()


def test_viewer_config_is_read_only_and_embedded(_onlyoffice_env):
    config = oo.build_viewer_config(
        _settings(),
        file_name="memo.docx",
        source_url="https://hub.example/api/v1/mail/office-source?t=x",
        document_key="view-mail-abc",
        source_kind="word",
        viewer_type="embedded",
        user_id=7,
        user_name="Тест",
    )

    assert config["type"] == "embedded"
    assert config["documentType"] == "word"
    perms = config["document"]["permissions"]
    assert perms["edit"] is False
    assert perms["comment"] is False
    assert perms["review"] is False
    assert perms["fillForms"] is False
    assert config["editorConfig"]["mode"] == "view"
    assert config["editorConfig"]["customization"]["coEditing"] == {"mode": "strict", "change": False}
    # The viewer config is self-contained for Document Server.
    claims = oo._decode(config["token"], SECRET)
    assert claims["document"]["key"] == "view-mail-abc"
    assert "callbackUrl" not in config.get("editorConfig", {})


def test_viewer_document_type_prefers_source_kind(_onlyoffice_env):
    assert oo.viewer_document_type(file_name="a.xls", source_kind="excel") == "cell"
    assert oo.viewer_document_type(file_name="a.odp", source_kind="presentation") == "slide"
    assert oo.viewer_document_type(file_name="a.docx") == "word"
    assert oo.viewer_document_type(file_name="a.bin") == ""


def test_mail_view_source_token_roundtrip_and_type_guard(_onlyoffice_env):
    settings = _settings()
    token = oo.make_mail_view_source_token(
        settings, user_id=9, message_id="m1", attachment_ref="att/1", mailbox_id="inbox"
    )
    claims = oo.read_mail_view_source_token(settings, token)
    assert claims["uid"] == 9
    assert claims["mid"] == "m1"
    assert claims["ref"] == "att/1"
    assert claims["mbx"] == "inbox"

    source_token = oo.make_source_token(settings, file_id="f1", blob_id="b1")
    with pytest.raises(oo.OnlyOfficeAuthError):
        oo.read_mail_view_source_token(settings, source_token)


def test_provider_resolution_envs(_onlyoffice_env, monkeypatch):
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "libreoffice")
    assert preview_service.resolve_office_preview_provider() == "libreoffice"
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "onlyoffice")
    assert preview_service.resolve_office_preview_provider() == "onlyoffice"
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "auto")
    assert preview_service.resolve_office_preview_provider() == "onlyoffice"


def test_provider_auto_falls_back_to_libreoffice(monkeypatch):
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "auto")
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "0")
    monkeypatch.delenv("ONLYOFFICE_JWT_SECRET", raising=False)
    monkeypatch.delenv("ONLYOFFICE_INTERNAL_URL", raising=False)
    assert preview_service.resolve_office_preview_provider() == "libreoffice"


def test_scan_server_provider_honours_enabled_flag(_onlyoffice_env, monkeypatch):
    import scan_server.document_conversion as scan_conv

    # "0" is disabled — the old non-empty-string check treated it as configured.
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "0")
    assert scan_conv._onlyoffice_configured() is False

    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    assert scan_conv._onlyoffice_configured() is True

    monkeypatch.delenv("ONLYOFFICE_JWT_SECRET", raising=False)
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", "")
    assert scan_conv._onlyoffice_configured() is False


def test_convert_source_to_pdf_routes_to_onlyoffice(_onlyoffice_env, monkeypatch, tmp_path):
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "onlyoffice")
    source = tmp_path / "source.docx"
    source.write_bytes(b"docx-content")
    out_dir = tmp_path / "out"
    captured = {}

    def fake_convert(*, filename, content, timeout_sec, max_output_bytes=None):
        captured.update(filename=filename, content=content, timeout_sec=timeout_sec)
        return b"%PDF-1.4 converted"

    import backend.services.onlyoffice_conversion_service as conversion

    monkeypatch.setattr(conversion, "convert_document_to_pdf", fake_convert)
    result = preview_service._convert_source_to_pdf(
        source_path=source, output_dir=out_dir, timeout_sec=45
    )
    assert result == out_dir / "source.pdf"
    assert result.read_bytes() == b"%PDF-1.4 converted"
    assert captured["filename"] == "source.docx"
    assert captured["content"] == b"docx-content"
    assert captured["timeout_sec"] == 45


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, body=b"", content_type="application/json"):
        self.status_code = status_code
        self._payload = payload
        self.content = body
        self.headers = {"content-type": content_type}

    def json(self):
        return self._payload

    def read(self):
        return self.content

    def iter_bytes(self, _chunk_size):
        yield self.content


class _FakeStream:
    def __init__(self, response):
        self._response = response

    def __enter__(self):
        return self._response

    def __exit__(self, *args):
        return False


class _FakeClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def stream(self, method, url, data=None, files=None):
        self.calls.append({"url": url, "data": data, "files": files})
        return _FakeStream(self._responses.pop(0))


def test_onlyoffice_conversion_polls_then_returns_pdf(_onlyoffice_env, monkeypatch):
    import backend.services.onlyoffice_conversion_service as conversion

    client = _FakeClient([
        _FakeResponse(payload={"endConvert": False}),
        _FakeResponse(body=b"%PDF-1.4 ready", content_type="application/pdf"),
    ])
    monkeypatch.setattr(conversion.httpx, "Client", lambda *a, **k: client)
    monkeypatch.setattr(conversion, "conversion_poll_interval_sec", lambda: 0.001)

    result = convert_document_to_pdf(filename="memo.docx", content=b"bytes", timeout_sec=30)

    assert result == b"%PDF-1.4 ready"
    assert len(client.calls) == 2
    # Async resend repeats the whole request, file included.
    assert "file" in client.calls[1]["files"]
    assert client.calls[1]["url"].endswith("/converter/from-file")


def test_onlyoffice_conversion_maps_server_error(_onlyoffice_env, monkeypatch):
    import backend.services.onlyoffice_conversion_service as conversion

    client = _FakeClient([_FakeResponse(payload={"error": -3})])
    monkeypatch.setattr(conversion.httpx, "Client", lambda *a, **k: client)

    with pytest.raises(OnlyOfficeConversionError, match="error -3"):
        convert_document_to_pdf(filename="memo.docx", content=b"bytes", timeout_sec=10)


def test_convert_source_to_pdf_auto_fails_over_to_libreoffice(_onlyoffice_env, monkeypatch, tmp_path):
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "auto")
    source = tmp_path / "source.docx"
    source.write_bytes(b"docx-content")
    out_dir = tmp_path / "out"

    import backend.services.onlyoffice_conversion_service as conversion

    def broken_convert(**_kwargs):
        raise RuntimeError("Document Server unreachable")

    monkeypatch.setattr(conversion, "convert_document_to_pdf", broken_convert)
    monkeypatch.setattr(
        preview_service,
        "resolve_soffice_path",
        lambda: tmp_path / "soffice.exe",
    )

    def fake_soffice(*, soffice, source_path, output_dir, timeout_sec):
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf = output_dir / f"{source_path.stem}.pdf"
        pdf.write_bytes(b"%PDF-1.4 from-lo")
        return pdf

    monkeypatch.setattr(preview_service, "_run_soffice_convert", fake_soffice)

    result = preview_service._convert_source_to_pdf(
        source_path=source, output_dir=out_dir, timeout_sec=30
    )
    assert result.read_bytes() == b"%PDF-1.4 from-lo"


def test_convert_source_to_pdf_explicit_onlyoffice_fails_loudly(_onlyoffice_env, monkeypatch, tmp_path):
    monkeypatch.setenv("OFFICE_PREVIEW_PROVIDER", "onlyoffice")
    source = tmp_path / "source.docx"
    source.write_bytes(b"docx-content")

    import backend.services.onlyoffice_conversion_service as conversion

    def broken_convert(**_kwargs):
        raise RuntimeError("Document Server unreachable")

    monkeypatch.setattr(conversion, "convert_document_to_pdf", broken_convert)
    monkeypatch.setattr(
        preview_service,
        "_run_soffice_convert",
        lambda **_kwargs: pytest.fail("must not fall back when provider is pinned"),
    )

    with pytest.raises(preview_service.MailAttachmentPreviewError, match="ONLYOFFICE"):
        preview_service._convert_source_to_pdf(
            source_path=source, output_dir=tmp_path / "out", timeout_sec=30
        )


def test_onlyoffice_conversion_rejects_oversized_stream(_onlyoffice_env, monkeypatch):
    import backend.services.onlyoffice_conversion_service as conversion

    client = _FakeClient([
        _FakeResponse(body=b"%PDF" + b"x" * 100, content_type="application/pdf")
    ])
    monkeypatch.setattr(conversion.httpx, "Client", lambda *a, **k: client)
    monkeypatch.setattr(conversion, "conversion_max_output_bytes", lambda: 8)

    with pytest.raises(OnlyOfficeConversionError, match="size limit"):
        convert_document_to_pdf(filename="memo.docx", content=b"bytes", timeout_sec=10)


def test_onlyoffice_conversion_rejects_non_pdf_body(_onlyoffice_env, monkeypatch):
    import backend.services.onlyoffice_conversion_service as conversion

    client = _FakeClient([_FakeResponse(body=b"not a pdf", content_type="application/pdf")])
    monkeypatch.setattr(conversion.httpx, "Client", lambda *a, **k: client)

    with pytest.raises(OnlyOfficeConversionError, match="non-PDF"):
        convert_document_to_pdf(filename="memo.docx", content=b"bytes", timeout_sec=10)
