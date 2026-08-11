from __future__ import annotations

import asyncio
from contextlib import contextmanager
from io import BytesIO
import sys
from pathlib import Path

import pytest
import httpx
from PIL import Image
from sqlalchemy.exc import IntegrityError


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.telegram_sticker_service import (  # noqa: E402
    TelegramStickerConfigurationError,
    TelegramStickerImportError,
    TelegramStickerService,
    _PREVIEW_CACHE_MARKER,
    _sticker_format,
    parse_telegram_sticker_pack_name,
)
from backend.chat.models import ChatSticker, ChatStickerPack, ChatUserStickerPack  # noqa: E402
import backend.chat.telegram_sticker_service as telegram_sticker_module  # noqa: E402


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("MyPack_by_bot", "MyPack_by_bot"),
        ("https://t.me/addstickers/MyPack_by_bot", "MyPack_by_bot"),
        ("t.me/addemoji/CustomEmojiPack?start=1", "CustomEmojiPack"),
        ("https://telegram.me/addstickers/MyPack_by_bot/", "MyPack_by_bot"),
    ],
)
def test_parse_telegram_sticker_pack_name(source: str, expected: str):
    assert parse_telegram_sticker_pack_name(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        "https://example.com/addstickers/pack",
        "https://t.me/share/url?url=pack",
        "pack with spaces",
        "",
    ],
)
def test_parse_telegram_sticker_pack_name_rejects_untrusted_sources(source: str):
    with pytest.raises(TelegramStickerImportError):
        parse_telegram_sticker_pack_name(source)


def test_sticker_format_maps_telegram_flags_to_browser_formats():
    assert _sticker_format({}) == ("static", "image/webp", ".webp")
    assert _sticker_format({"is_video": True}) == ("video", "video/webm", ".webm")
    assert _sticker_format({"is_animated": True}) == (
        "animated",
        "application/x-tgsticker",
        ".tgs",
    )


def test_import_requires_a_server_side_telegram_token(temp_dir: str):
    service = TelegramStickerService(storage_root=Path(temp_dir), token_getter=lambda: "")

    with pytest.raises(TelegramStickerConfigurationError):
        service._token()


def test_cached_pack_is_unavailable_when_a_sticker_file_is_missing(temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    pack_dir = storage_root / "pack-1"
    pack_dir.mkdir()
    (pack_dir / "present.webp").write_bytes(b"sticker")

    assert service._pack_files_available(
        pack_id="pack-1",
        storage_names=["present.webp", "missing.webp"],
    ) is False


def test_cached_pack_requires_completed_preview_cache(temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    pack_dir = storage_root / "pack-1"
    pack_dir.mkdir()

    assert service._pack_preview_cache_available(pack_id="pack-1") is False

    (pack_dir / _PREVIEW_CACHE_MARKER).write_text("ready", encoding="ascii")

    assert service._pack_preview_cache_available(pack_id="pack-1") is True


def test_telegram_preview_is_resized_for_the_picker(temp_dir: str):
    service = TelegramStickerService(storage_root=Path(temp_dir), token_getter=lambda: "token")
    source = BytesIO()
    Image.new("RGBA", (320, 320), (225, 80, 120, 220)).save(source, format="WEBP", quality=100)

    optimized = service._optimize_preview_bytes(source.getvalue())

    with Image.open(BytesIO(optimized)) as image:
        assert image.format == "WEBP"
        assert image.size == (128, 128)


@pytest.mark.asyncio
async def test_download_sticker_stores_lightweight_telegram_preview(monkeypatch, temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")

    async def fake_telegram_json(_client, *, params, **_kwargs):
        file_id = params["file_id"]
        return {"file_path": f"stickers/{file_id}.webp"}

    async def fake_get(_client, url, **_kwargs):
        content = b"full-sticker" if "original-file" in url else b"small-preview"
        return httpx.Response(200, content=content)

    monkeypatch.setattr(service, "_telegram_json", fake_telegram_json)
    monkeypatch.setattr(service, "_get_with_dns_fallback", fake_get)

    item = await service._download_sticker(
        object(),
        token="token",
        sticker_payload={
            "file_id": "original-file",
            "file_unique_id": "unique-file",
            "thumbnail": {"file_id": "preview-file", "width": 320, "height": 320},
        },
        index=0,
        target_dir=storage_root,
        semaphore=asyncio.Semaphore(1),
    )

    assert (storage_root / item["storage_name"]).read_bytes() == b"full-sticker"
    assert (storage_root / f'{item["id"]}.preview').read_bytes() == b"small-preview"


@pytest.mark.asyncio
async def test_telegram_request_retries_via_tls_verified_ip_when_dns_fails(
    monkeypatch,
    temp_dir: str,
):
    monkeypatch.setenv("TELEGRAM_BOT_API_FALLBACK_IP", "149.154.167.220")
    service = TelegramStickerService(storage_root=Path(temp_dir), token_getter=lambda: "token")
    expected = httpx.Response(200, json={"ok": True})

    class FakeClient:
        def __init__(self):
            self.calls = []

        async def get(self, url, **kwargs):
            self.calls.append((url, kwargs))
            if len(self.calls) == 1:
                raise httpx.ConnectError("getaddrinfo failed")
            return expected

    client = FakeClient()
    response = await service._get_with_dns_fallback(
        client,
        "https://api.telegram.org/bottoken/getStickerSet",
        params={"name": "frrl52"},
    )

    assert response is expected
    assert client.calls[1] == (
        "https://149.154.167.220/bottoken/getStickerSet",
        {
            "params": {"name": "frrl52"},
            "headers": {"Host": "api.telegram.org"},
            "extensions": {"sni_hostname": "api.telegram.org"},
        },
    )

    await service._get_with_dns_fallback(
        client,
        "https://api.telegram.org/bottoken/getFile",
        params={"file_id": "file-1"},
    )

    assert len(client.calls) == 3
    assert client.calls[2][0] == "https://149.154.167.220/bottoken/getFile"


class _FakeStickerSession:
    def __init__(self, *, pack, cached_stickers, installed):
        self._results = iter([
            _FakeScalarResult(single=pack),
            _FakeScalarResult(items=cached_stickers),
            _FakeScalarResult(single=installed),
        ])
        self.added = []
        self.deleted = []
        self.flush_count = 0

    def execute(self, _statement):
        return next(self._results)

    def add(self, item):
        self.added.append(item)

    def delete(self, item):
        self.deleted.append(item)

    def flush(self):
        self.flush_count += 1


class _FakeScalarResult:
    def __init__(self, *, single=None, items=None):
        self._single = single
        self._items = list(items or [])

    def scalar_one_or_none(self):
        return self._single

    def scalars(self):
        return iter(self._items)


def _staged_sticker_payload(storage_name: str = "new.webp") -> dict:
    return {
        "id": "new-sticker",
        "telegram_file_id": "telegram-file",
        "telegram_file_unique_id": "telegram-unique",
        "emoji": "🙂",
        "format": "static",
        "mime_type": "image/webp",
        "storage_name": storage_name,
        "file_size": 3,
        "width": 512,
        "height": 512,
        "sort_order": 0,
    }


def test_preview_pack_uses_cached_static_previews_without_installing(monkeypatch, temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    pack = ChatStickerPack(
        id="pack-1",
        short_name="frrl52",
        title="Funny pack",
        sticker_type="regular",
    )
    sticker = ChatSticker(
        id="sticker-1",
        pack_id=pack.id,
        telegram_file_id="telegram-file",
        telegram_file_unique_id="telegram-unique",
        emoji="🙂",
        format="static",
        mime_type="image/webp",
        storage_name="sticker.webp",
        file_size=123,
        width=512,
        height=512,
        sort_order=0,
    )
    pack_dir = storage_root / pack.id
    pack_dir.mkdir()
    (pack_dir / "sticker-1.preview").write_bytes(b"preview")
    session = _FakeStickerSession(pack=pack, cached_stickers=[sticker], installed=None)

    @contextmanager
    def fake_read_session():
        yield session

    monkeypatch.setattr(telegram_sticker_module, "chat_read_session", fake_read_session)

    result = service.preview_pack(current_user_id=7, short_name="frrl52")

    assert result["short_name"] == "frrl52"
    assert result["is_added"] is False
    assert result["stickers"][0]["preview_url"] == (
        "/api/v1/chat/sticker-packs/preview/frrl52/stickers/sticker-1/preview"
    )
    assert result["stickers"][0]["file_url"] == (
        "/api/v1/chat/sticker-packs/preview/frrl52/stickers/sticker-1/file"
    )


def test_persist_imported_pack_replaces_broken_cached_files(monkeypatch, temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    existing_dir = storage_root / "existing-pack"
    existing_dir.mkdir()
    (existing_dir / "old.webp").write_bytes(b"old")
    staged_dir = storage_root / ".import-new"
    staged_dir.mkdir()
    (staged_dir / "new.webp").write_bytes(b"new")

    pack = ChatStickerPack(id="existing-pack", short_name="frrl52", title="Old", sticker_type="regular")
    cached = ChatSticker(
        id="old-sticker",
        pack_id=pack.id,
        telegram_file_id="old-file",
        telegram_file_unique_id="old-unique",
        emoji="",
        format="static",
        mime_type="image/webp",
        storage_name="old.webp",
        file_size=3,
        sort_order=0,
    )
    installed = ChatUserStickerPack(user_id=7, pack_id=pack.id)
    session = _FakeStickerSession(pack=pack, cached_stickers=[cached], installed=installed)

    @contextmanager
    def fake_write_session():
        yield session

    monkeypatch.setattr(telegram_sticker_module, "chat_write_session", fake_write_session)

    target_pack_id = service._persist_imported_pack(
        current_user_id=7,
        pack_id="unused-new-pack",
        short_name="frrl52",
        title="Fresh pack",
        sticker_type="regular",
        stickers=[_staged_sticker_payload()],
        staged_dir=staged_dir,
    )

    assert target_pack_id == "existing-pack"
    assert not staged_dir.exists()
    assert not (existing_dir / "old.webp").exists()
    assert (existing_dir / "new.webp").read_bytes() == b"new"
    assert session.deleted == [cached]
    assert session.flush_count == 1
    assert any(isinstance(item, ChatSticker) and item.pack_id == pack.id for item in session.added)
    assert not list(storage_root.glob(".backup-*"))


def test_persist_imported_pack_flushes_new_pack_before_its_stickers(monkeypatch, temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    staged_dir = storage_root / ".import-new"
    staged_dir.mkdir()
    (staged_dir / "new.webp").write_bytes(b"new")
    session = _FakeStickerSession(pack=None, cached_stickers=[], installed=None)

    @contextmanager
    def fake_write_session():
        yield session

    monkeypatch.setattr(telegram_sticker_module, "chat_write_session", fake_write_session)

    service._persist_imported_pack(
        current_user_id=7,
        pack_id="new-pack",
        short_name="frrl52",
        title="Fresh pack",
        sticker_type="regular",
        stickers=[_staged_sticker_payload()],
        staged_dir=staged_dir,
    )

    assert session.flush_count == 1
    assert any(isinstance(item, ChatStickerPack) and item.id == "new-pack" for item in session.added)
    assert any(isinstance(item, ChatSticker) and item.pack_id == "new-pack" for item in session.added)


@pytest.mark.asyncio
async def test_import_does_not_hide_unrelated_integrity_error(monkeypatch, temp_dir: str):
    service = TelegramStickerService(storage_root=Path(temp_dir), token_getter=lambda: "token")
    cache_checks = iter([False, False])
    monkeypatch.setattr(service, "_add_cached_pack", lambda **_kwargs: next(cache_checks))
    monkeypatch.setattr(service, "_serialize_packs", lambda **_kwargs: {"items": []})

    async def fake_telegram_json(*_args, **_kwargs):
        return {
            "name": "frrl52",
            "title": "Fresh pack",
            "sticker_type": "regular",
            "stickers": [{"file_id": "file", "file_unique_id": "unique"}],
        }

    async def fake_download_sticker(*_args, target_dir, **_kwargs):
        (target_dir / "new.webp").write_bytes(b"new")
        return _staged_sticker_payload()

    def fail_persist(**_kwargs):
        raise IntegrityError("insert", {}, RuntimeError("foreign key violation"))

    monkeypatch.setattr(service, "_telegram_json", fake_telegram_json)
    monkeypatch.setattr(service, "_download_sticker", fake_download_sticker)
    monkeypatch.setattr(service, "_persist_imported_pack", fail_persist)

    with pytest.raises(IntegrityError):
        await service.import_pack(current_user_id=7, source="frrl52")


def test_persist_imported_pack_restores_old_files_when_commit_fails(monkeypatch, temp_dir: str):
    storage_root = Path(temp_dir)
    service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    existing_dir = storage_root / "existing-pack"
    existing_dir.mkdir()
    (existing_dir / "old.webp").write_bytes(b"old")
    staged_dir = storage_root / ".import-new"
    staged_dir.mkdir()
    (staged_dir / "new.webp").write_bytes(b"new")

    pack = ChatStickerPack(id="existing-pack", short_name="frrl52", title="Old", sticker_type="regular")
    session = _FakeStickerSession(
        pack=pack,
        cached_stickers=[],
        installed=ChatUserStickerPack(user_id=7, pack_id=pack.id),
    )

    @contextmanager
    def failing_write_session():
        yield session
        raise RuntimeError("commit failed")

    monkeypatch.setattr(telegram_sticker_module, "chat_write_session", failing_write_session)

    with pytest.raises(RuntimeError, match="commit failed"):
        service._persist_imported_pack(
            current_user_id=7,
            pack_id="unused-new-pack",
            short_name="frrl52",
            title="Fresh pack",
            sticker_type="regular",
            stickers=[_staged_sticker_payload()],
            staged_dir=staged_dir,
        )

    assert (existing_dir / "old.webp").read_bytes() == b"old"
    assert not (existing_dir / "new.webp").exists()
    assert not list(storage_root.glob(".backup-*"))
