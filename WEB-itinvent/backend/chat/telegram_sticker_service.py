"""Telegram sticker-pack import and sending for the built-in chat."""
from __future__ import annotations

import asyncio
import filecmp
from io import BytesIO
import logging
import os
import re
import shutil
import time
from datetime import datetime, timezone
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlsplit, urlunsplit
from uuid import uuid4

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.chat.db import chat_read_session, chat_write_session
from backend.chat.models import ChatSticker, ChatStickerPack, ChatUserStickerPack
from backend.services.hub_service import hub_service


# Bot API credentials are embedded in Telegram request URLs. httpx logs full
# request URLs at INFO, so keep those requests out of application logs.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


_PACK_LINK_RE = re.compile(
    r"^(?:(?:https?://)?(?:t\.me|telegram\.me)/(?:addstickers|addemoji)/)?"
    r"([A-Za-z0-9_]{1,128})/?(?:\?.*)?$",
    re.IGNORECASE,
)
_LEGACY_MESSAGE_STICKER_RE = re.compile(
    r"^sticker-(?P<pack_short_name>[A-Za-z0-9_]{1,128})\.(?:tgs|webm|webp)$",
    re.IGNORECASE,
)
_MAX_STICKERS_PER_PACK = 200
_MAX_STICKER_BYTES = 5 * 1024 * 1024
_MAX_STICKER_PREVIEW_BYTES = 512 * 1024
_MAX_PACK_BYTES = 100 * 1024 * 1024
_PREVIEW_MAX_DIMENSION = 128
_PREVIEW_CACHE_MARKER = ".previews-v2"
_TELEGRAM_API_HOST = "api.telegram.org"
_DEFAULT_TELEGRAM_API_FALLBACK_IP = "149.154.167.220"
_TELEGRAM_API_FALLBACK_TTL_SECONDS = 10 * 60


class TelegramStickerConfigurationError(RuntimeError):
    """Telegram Bot API is unavailable because its token is not configured."""


class TelegramStickerImportError(ValueError):
    """Telegram rejected the pack or returned an invalid sticker payload."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_telegram_sticker_pack_name(value: object) -> str:
    normalized = str(value or "").strip()
    match = _PACK_LINK_RE.fullmatch(normalized)
    if match is None:
        raise TelegramStickerImportError(
            "Укажите ссылку вида https://t.me/addstickers/PackName"
        )
    return match.group(1)


def _sticker_format(payload: dict[str, Any]) -> tuple[str, str, str]:
    if bool(payload.get("is_animated")):
        return "animated", "application/x-tgsticker", ".tgs"
    if bool(payload.get("is_video")):
        return "video", "video/webm", ".webm"
    return "static", "image/webp", ".webp"


class TelegramStickerService:
    def __init__(
        self,
        *,
        storage_root: Path | None = None,
        token_getter: Callable[[], str] | None = None,
    ) -> None:
        self._storage_root = Path(storage_root or (Path(hub_service.data_dir) / "chat_sticker_packs"))
        self._storage_root.mkdir(parents=True, exist_ok=True)
        self._token_getter = token_getter or (lambda: str(os.getenv("TELEGRAM_BOT_TOKEN", "") or "").strip())
        self._import_locks: dict[str, asyncio.Lock] = {}
        self._telegram_fallback_until = 0.0

    def _token(self) -> str:
        token = str(self._token_getter() or "").strip()
        if not token:
            raise TelegramStickerConfigurationError(
                "TELEGRAM_BOT_TOKEN не настроен — импорт наборов Telegram недоступен"
            )
        return token

    def _pack_file_url(self, sticker_id: str) -> str:
        return f"/api/v1/chat/stickers/{quote(str(sticker_id), safe='')}/file"

    def _pack_preview_url(self, sticker_id: str) -> str:
        return f"/api/v1/chat/stickers/{quote(str(sticker_id), safe='')}/preview"

    def _shared_pack_file_url(self, short_name: str, sticker_id: str) -> str:
        encoded_pack = quote(str(short_name), safe="")
        encoded_sticker = quote(str(sticker_id), safe="")
        return f"/api/v1/chat/sticker-packs/preview/{encoded_pack}/stickers/{encoded_sticker}/file"

    def _shared_pack_preview_url(self, short_name: str, sticker_id: str) -> str:
        encoded_pack = quote(str(short_name), safe="")
        encoded_sticker = quote(str(sticker_id), safe="")
        return f"/api/v1/chat/sticker-packs/preview/{encoded_pack}/stickers/{encoded_sticker}/preview"

    @staticmethod
    def _preview_storage_name(sticker_id: str) -> str:
        return f"{Path(str(sticker_id)).name}.preview"

    @staticmethod
    def _optimize_preview_bytes(content: bytes) -> bytes:
        try:
            with Image.open(BytesIO(content)) as image:
                image.thumbnail(
                    (_PREVIEW_MAX_DIMENSION, _PREVIEW_MAX_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "transparency" in image.info else "RGB")
                output = BytesIO()
                image.save(output, format="WEBP", quality=76, method=4)
                optimized = output.getvalue()
                return optimized or content
        except (OSError, ValueError, Image.DecompressionBombError):
            return content

    def _preview_path(self, *, pack_id: str, sticker_id: str) -> Path:
        return self._storage_root / Path(str(pack_id)).name / self._preview_storage_name(sticker_id)

    def _telegram_fallback_ip(self) -> str:
        value = str(
            os.getenv("TELEGRAM_BOT_API_FALLBACK_IP", _DEFAULT_TELEGRAM_API_FALLBACK_IP)
            or ""
        ).strip()
        if not value:
            return ""
        try:
            return str(ip_address(value))
        except ValueError:
            return ""

    async def _get_with_dns_fallback(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        fallback_ip = self._telegram_fallback_ip()
        if fallback_ip and time.monotonic() < self._telegram_fallback_until:
            return await self._get_via_telegram_fallback(
                client,
                url,
                fallback_ip=fallback_ip,
                params=params,
            )
        try:
            return await client.get(url, params=params)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            if not fallback_ip:
                raise
            self._telegram_fallback_until = (
                time.monotonic() + _TELEGRAM_API_FALLBACK_TTL_SECONDS
            )
            logger.warning(
                "Telegram Bot API direct DNS connection failed; enabling TLS fallback for %ss error_type=%s",
                _TELEGRAM_API_FALLBACK_TTL_SECONDS,
                type(exc).__name__,
            )
            try:
                return await self._get_via_telegram_fallback(
                    client,
                    url,
                    fallback_ip=fallback_ip,
                    params=params,
                )
            except httpx.HTTPError:
                self._telegram_fallback_until = 0.0
                raise

    async def _get_via_telegram_fallback(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        fallback_ip: str,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        parsed = urlsplit(url)
        if parsed.hostname != _TELEGRAM_API_HOST:
            raise httpx.ConnectError("Telegram fallback rejected a non-Telegram host")
        fallback_host = f"[{fallback_ip}]" if ":" in fallback_ip else fallback_ip
        fallback_url = urlunsplit(
            (parsed.scheme, fallback_host, parsed.path, parsed.query, parsed.fragment)
        )
        return await client.get(
                fallback_url,
                params=params,
                headers={"Host": _TELEGRAM_API_HOST},
                extensions={"sni_hostname": _TELEGRAM_API_HOST},
            )

    def _serialize_packs(self, *, current_user_id: int) -> dict[str, Any]:
        with chat_read_session() as session:
            packs = list(
                session.execute(
                    select(ChatStickerPack)
                    .join(ChatUserStickerPack, ChatUserStickerPack.pack_id == ChatStickerPack.id)
                    .where(ChatUserStickerPack.user_id == int(current_user_id))
                    .order_by(ChatUserStickerPack.added_at.asc(), ChatStickerPack.title.asc())
                ).scalars()
            )
            pack_ids = [item.id for item in packs]
            stickers_by_pack: dict[str, list[dict[str, Any]]] = {pack_id: [] for pack_id in pack_ids}
            if pack_ids:
                stickers = list(
                    session.execute(
                        select(ChatSticker)
                        .where(ChatSticker.pack_id.in_(pack_ids))
                        .order_by(ChatSticker.pack_id.asc(), ChatSticker.sort_order.asc())
                    ).scalars()
                )
                for sticker in stickers:
                    stickers_by_pack.setdefault(sticker.pack_id, []).append(
                        {
                            "id": sticker.id,
                            "emoji": sticker.emoji or "",
                            "format": sticker.format,
                            "mime_type": sticker.mime_type,
                            "file_size": int(sticker.file_size or 0),
                            "width": int(sticker.width) if sticker.width is not None else None,
                            "height": int(sticker.height) if sticker.height is not None else None,
                            "file_url": self._pack_file_url(sticker.id),
                            "preview_url": (
                                self._pack_preview_url(sticker.id)
                                if self._preview_path(pack_id=sticker.pack_id, sticker_id=sticker.id).is_file()
                                else None
                            ),
                        }
                    )
            return {
                "items": [
                    {
                        "id": pack.id,
                        "short_name": pack.short_name,
                        "title": pack.title,
                        "sticker_type": pack.sticker_type,
                        "is_added": True,
                        "stickers": stickers_by_pack.get(pack.id, []),
                    }
                    for pack in packs
                ]
            }

    def list_packs(self, *, current_user_id: int) -> dict[str, Any]:
        return self._serialize_packs(current_user_id=int(current_user_id))

    def preview_pack(self, *, current_user_id: int, short_name: str) -> dict[str, Any]:
        normalized_short_name = parse_telegram_sticker_pack_name(short_name)
        with chat_read_session() as session:
            pack = session.execute(
                select(ChatStickerPack).where(ChatStickerPack.short_name == normalized_short_name)
            ).scalar_one_or_none()
            if pack is None:
                raise LookupError("Набор стикеров не найден")
            stickers = list(
                session.execute(
                    select(ChatSticker)
                    .where(ChatSticker.pack_id == pack.id)
                    .order_by(ChatSticker.sort_order.asc())
                ).scalars()
            )
            installed = session.execute(
                select(ChatUserStickerPack).where(
                    ChatUserStickerPack.user_id == int(current_user_id),
                    ChatUserStickerPack.pack_id == pack.id,
                )
            ).scalar_one_or_none()

        return {
            "id": pack.id,
            "short_name": pack.short_name,
            "title": pack.title,
            "sticker_type": pack.sticker_type,
            "is_added": installed is not None,
            "stickers": [
                {
                    "id": sticker.id,
                    "emoji": sticker.emoji or "",
                    "format": sticker.format,
                    "mime_type": sticker.mime_type,
                    "file_size": int(sticker.file_size or 0),
                    "width": int(sticker.width) if sticker.width is not None else None,
                    "height": int(sticker.height) if sticker.height is not None else None,
                    "file_url": self._shared_pack_file_url(pack.short_name, sticker.id),
                    "preview_url": (
                        self._shared_pack_preview_url(pack.short_name, sticker.id)
                        if self._preview_path(pack_id=pack.id, sticker_id=sticker.id).is_file()
                        else None
                    ),
                }
                for sticker in stickers
            ],
        }

    def _pack_files_available(self, *, pack_id: str, storage_names: list[str]) -> bool:
        if not storage_names:
            return False
        pack_dir = self._storage_root / str(pack_id)
        try:
            return all(
                (pack_dir / Path(storage_name).name).is_file()
                and (pack_dir / Path(storage_name).name).stat().st_size > 0
                for storage_name in storage_names
            )
        except OSError:
            return False

    def _pack_preview_cache_available(self, *, pack_id: str) -> bool:
        marker = self._storage_root / Path(str(pack_id)).name / _PREVIEW_CACHE_MARKER
        try:
            return marker.is_file() and marker.stat().st_size > 0
        except OSError:
            return False

    def _add_cached_pack(self, *, current_user_id: int, short_name: str) -> bool:
        with chat_write_session() as session:
            pack = session.execute(
                select(ChatStickerPack).where(ChatStickerPack.short_name == short_name)
            ).scalar_one_or_none()
            if pack is None:
                return False
            storage_names = list(
                session.execute(
                    select(ChatSticker.storage_name).where(ChatSticker.pack_id == pack.id)
                ).scalars()
            )
            if not self._pack_files_available(pack_id=pack.id, storage_names=storage_names):
                return False
            if not self._pack_preview_cache_available(pack_id=pack.id):
                return False
            installed = session.execute(
                select(ChatUserStickerPack).where(
                    ChatUserStickerPack.user_id == int(current_user_id),
                    ChatUserStickerPack.pack_id == pack.id,
                )
            ).scalar_one_or_none()
            if installed is None:
                session.add(
                    ChatUserStickerPack(
                        user_id=int(current_user_id),
                        pack_id=pack.id,
                        added_at=utcnow(),
                    )
                )
            return True

    async def _telegram_json(
        self,
        client: httpx.AsyncClient,
        *,
        token: str,
        method: str,
        params: dict[str, str],
    ) -> Any:
        try:
            response = await self._get_with_dns_fallback(
                client,
                f"https://{_TELEGRAM_API_HOST}/bot{token}/{method}",
                params=params,
            )
        except httpx.HTTPError as exc:
            raise TelegramStickerImportError("Не удалось связаться с Telegram") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise TelegramStickerImportError("Telegram вернул некорректный ответ") from exc
        if response.status_code != 200 or not bool(payload.get("ok")):
            description = str(payload.get("description") or "Telegram не нашёл этот набор").strip()
            raise TelegramStickerImportError(description[:240])
        return payload.get("result")

    async def _download_telegram_file(
        self,
        client: httpx.AsyncClient,
        *,
        token: str,
        file_id: str,
        max_bytes: int,
        file_label: str,
    ) -> bytes:
        file_meta = await self._telegram_json(
            client,
            token=token,
            method="getFile",
            params={"file_id": file_id},
        )
        file_path = str((file_meta or {}).get("file_path") or "").strip()
        if not file_path:
            raise TelegramStickerImportError(f"Telegram не вернул файл: {file_label}")
        try:
            response = await self._get_with_dns_fallback(
                client,
                f"https://{_TELEGRAM_API_HOST}/file/bot{token}/{quote(file_path, safe='/')}",
            )
        except httpx.HTTPError as exc:
            raise TelegramStickerImportError(f"Не удалось скачать {file_label} из Telegram") from exc
        if response.status_code != 200:
            raise TelegramStickerImportError(f"Telegram не разрешил скачать {file_label}")
        content = bytes(response.content or b"")
        if not content:
            raise TelegramStickerImportError(f"Telegram вернул пустой файл: {file_label}")
        if len(content) > max_bytes:
            raise TelegramStickerImportError(f"Файл превышает допустимый размер: {file_label}")
        return content

    async def _download_sticker(
        self,
        client: httpx.AsyncClient,
        *,
        token: str,
        sticker_payload: dict[str, Any],
        index: int,
        target_dir: Path,
        semaphore: asyncio.Semaphore,
    ) -> dict[str, Any]:
        async with semaphore:
            file_id = str(sticker_payload.get("file_id") or "").strip()
            file_unique_id = str(sticker_payload.get("file_unique_id") or "").strip()
            if not file_id or not file_unique_id:
                raise TelegramStickerImportError("В наборе найден стикер без идентификатора файла")
            content = await self._download_telegram_file(
                client,
                token=token,
                file_id=file_id,
                max_bytes=_MAX_STICKER_BYTES,
                file_label="стикер",
            )

            sticker_id = str(uuid4())
            sticker_format, mime_type, extension = _sticker_format(sticker_payload)
            storage_name = f"{sticker_id}{extension}"
            await asyncio.to_thread((target_dir / storage_name).write_bytes, content)

            thumbnail = sticker_payload.get("thumbnail") or {}
            thumbnail_file_id = str(thumbnail.get("file_id") or "").strip()
            if thumbnail_file_id:
                try:
                    preview_content = await self._download_telegram_file(
                        client,
                        token=token,
                        file_id=thumbnail_file_id,
                        max_bytes=_MAX_STICKER_PREVIEW_BYTES,
                        file_label="превью стикера",
                    )
                except TelegramStickerImportError:
                    preview_content = b""
                if preview_content:
                    preview_content = await asyncio.to_thread(
                        self._optimize_preview_bytes,
                        preview_content,
                    )
                    preview_path = target_dir / self._preview_storage_name(sticker_id)
                    await asyncio.to_thread(preview_path.write_bytes, preview_content)
            return {
                "id": sticker_id,
                "telegram_file_id": file_id,
                "telegram_file_unique_id": file_unique_id,
                "emoji": str(sticker_payload.get("emoji") or "").strip()[:64],
                "format": sticker_format,
                "mime_type": mime_type,
                "storage_name": storage_name,
                "file_size": len(content),
                "width": int(sticker_payload.get("width")) if sticker_payload.get("width") is not None else None,
                "height": int(sticker_payload.get("height")) if sticker_payload.get("height") is not None else None,
                "sort_order": int(index),
            }

    def _persist_imported_pack(
        self,
        *,
        current_user_id: int,
        pack_id: str,
        short_name: str,
        title: str,
        sticker_type: str,
        stickers: list[dict[str, Any]],
        staged_dir: Path,
    ) -> str:
        now = utcnow()
        target_dir: Path | None = None
        backup_dir: Path | None = None
        try:
            with chat_write_session() as session:
                existing = session.execute(
                    select(ChatStickerPack)
                    .where(ChatStickerPack.short_name == short_name)
                    .with_for_update()
                ).scalar_one_or_none()
                target_pack_id = existing.id if existing is not None else pack_id
                target_dir = self._storage_root / target_pack_id
                backup_dir = self._storage_root / f".backup-{target_pack_id}-{uuid4()}"
                if target_dir.exists():
                    target_dir.replace(backup_dir)
                staged_dir.replace(target_dir)

                if existing is None:
                    existing = ChatStickerPack(
                        id=target_pack_id,
                        short_name=short_name,
                        title=title[:255] or short_name,
                        sticker_type=sticker_type[:32] or "regular",
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(existing)
                    # The chat session uses autoflush=False. Persist the parent
                    # before inserting stickers that reference it.
                    session.flush()
                else:
                    existing.title = title[:255] or short_name
                    existing.sticker_type = sticker_type[:32] or "regular"
                    existing.updated_at = now
                    for cached_sticker in session.execute(
                        select(ChatSticker).where(ChatSticker.pack_id == target_pack_id)
                    ).scalars():
                        session.delete(cached_sticker)
                    session.flush()

                for item in stickers:
                    session.add(
                        ChatSticker(
                            id=item["id"],
                            pack_id=target_pack_id,
                            telegram_file_id=item["telegram_file_id"],
                            telegram_file_unique_id=item["telegram_file_unique_id"],
                            emoji=item["emoji"],
                            format=item["format"],
                            mime_type=item["mime_type"],
                            storage_name=item["storage_name"],
                            file_size=int(item["file_size"]),
                            width=item.get("width"),
                            height=item.get("height"),
                            sort_order=int(item["sort_order"]),
                            created_at=now,
                        )
                    )
                installed = session.execute(
                    select(ChatUserStickerPack).where(
                        ChatUserStickerPack.user_id == int(current_user_id),
                        ChatUserStickerPack.pack_id == target_pack_id,
                    )
                ).scalar_one_or_none()
                if installed is None:
                    session.add(
                        ChatUserStickerPack(
                            user_id=int(current_user_id),
                            pack_id=target_pack_id,
                            added_at=now,
                        )
                    )
            if backup_dir.exists():
                shutil.rmtree(backup_dir, True)
            return target_pack_id
        except Exception:
            if target_dir is not None and target_dir.exists():
                shutil.rmtree(target_dir, True)
            if backup_dir is not None and backup_dir.exists() and target_dir is not None:
                backup_dir.replace(target_dir)
            raise

    async def import_pack(self, *, current_user_id: int, source: object) -> dict[str, Any]:
        short_name = parse_telegram_sticker_pack_name(source)
        lock = self._import_locks.setdefault(short_name.lower(), asyncio.Lock())
        async with lock:
            if await asyncio.to_thread(
                self._add_cached_pack,
                current_user_id=int(current_user_id),
                short_name=short_name,
            ):
                return await asyncio.to_thread(self._serialize_packs, current_user_id=int(current_user_id))

            token = self._token()
            timeout = httpx.Timeout(connect=8.0, read=30.0, write=15.0, pool=8.0)
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=False,
            ) as client:
                pack_payload = await self._telegram_json(
                    client,
                    token=token,
                    method="getStickerSet",
                    params={"name": short_name},
                )
                telegram_stickers = list((pack_payload or {}).get("stickers") or [])[:_MAX_STICKERS_PER_PACK]
                if not telegram_stickers:
                    raise TelegramStickerImportError("В наборе Telegram нет доступных стикеров")

                pack_id = str(uuid4())
                temp_dir = self._storage_root / f".import-{pack_id}"
                await asyncio.to_thread(temp_dir.mkdir, parents=True, exist_ok=False)
                try:
                    semaphore = asyncio.Semaphore(6)
                    stickers = await asyncio.gather(*[
                        self._download_sticker(
                            client,
                            token=token,
                            sticker_payload=item,
                            index=index,
                            target_dir=temp_dir,
                            semaphore=semaphore,
                        )
                        for index, item in enumerate(telegram_stickers)
                    ])
                    await asyncio.to_thread(
                        (temp_dir / _PREVIEW_CACHE_MARKER).write_text,
                        "ready",
                        encoding="ascii",
                    )
                    if sum(int(item["file_size"]) for item in stickers) > _MAX_PACK_BYTES:
                        raise TelegramStickerImportError("Набор стикеров превышает допустимый размер")
                    try:
                        await asyncio.to_thread(
                            self._persist_imported_pack,
                            current_user_id=int(current_user_id),
                            pack_id=pack_id,
                            short_name=str((pack_payload or {}).get("name") or short_name).strip() or short_name,
                            title=str((pack_payload or {}).get("title") or short_name).strip() or short_name,
                            sticker_type=str((pack_payload or {}).get("sticker_type") or "regular").strip() or "regular",
                            stickers=stickers,
                            staged_dir=temp_dir,
                        )
                    except IntegrityError:
                        recovered = await asyncio.to_thread(
                            self._add_cached_pack,
                            current_user_id=int(current_user_id),
                            short_name=short_name,
                        )
                        if not recovered:
                            raise
                except Exception:
                    await asyncio.to_thread(shutil.rmtree, temp_dir, True)
                    raise
            return await asyncio.to_thread(self._serialize_packs, current_user_id=int(current_user_id))

    def remove_pack(self, *, current_user_id: int, pack_id: str) -> dict[str, Any]:
        normalized_pack_id = str(pack_id or "").strip()
        with chat_write_session() as session:
            installed = session.execute(
                select(ChatUserStickerPack).where(
                    ChatUserStickerPack.user_id == int(current_user_id),
                    ChatUserStickerPack.pack_id == normalized_pack_id,
                )
            ).scalar_one_or_none()
            if installed is None:
                raise LookupError("Набор стикеров не найден")
            session.delete(installed)
        return {"ok": True}

    def _resolve_sticker_file_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        root = self._storage_root.resolve()
        path = (
            root
            / Path(str(payload["pack_id"])).name
            / Path(str(payload["storage_name"])).name
        ).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Некорректный путь стикера") from exc
        if not path.exists() or not path.is_file():
            raise LookupError("Файл стикера не найден")
        return {**payload, "path": str(path)}

    def get_sticker_file(self, *, current_user_id: int, sticker_id: str) -> dict[str, Any]:
        normalized_sticker_id = str(sticker_id or "").strip()
        with chat_read_session() as session:
            row = session.execute(
                select(ChatSticker, ChatStickerPack)
                .join(ChatStickerPack, ChatStickerPack.id == ChatSticker.pack_id)
                .join(ChatUserStickerPack, ChatUserStickerPack.pack_id == ChatStickerPack.id)
                .where(
                    ChatSticker.id == normalized_sticker_id,
                    ChatUserStickerPack.user_id == int(current_user_id),
                )
            ).first()
            if row is None:
                raise LookupError("Стикер не найден")
            sticker, pack = row
            payload = {
                "pack_id": pack.id,
                "storage_name": sticker.storage_name,
                "mime_type": sticker.mime_type,
                "file_name": sticker.storage_name,
            }
        return self._resolve_sticker_file_payload(payload)

    def get_pack_sticker_file(self, *, short_name: str, sticker_id: str) -> dict[str, Any]:
        normalized_short_name = parse_telegram_sticker_pack_name(short_name)
        normalized_sticker_id = str(sticker_id or "").strip()
        with chat_read_session() as session:
            row = session.execute(
                select(ChatSticker, ChatStickerPack)
                .join(ChatStickerPack, ChatStickerPack.id == ChatSticker.pack_id)
                .where(
                    ChatSticker.id == normalized_sticker_id,
                    ChatStickerPack.short_name == normalized_short_name,
                )
            ).first()
            if row is None:
                raise LookupError("Стикер не найден")
            sticker, pack = row
            payload = {
                "pack_id": pack.id,
                "storage_name": sticker.storage_name,
                "mime_type": sticker.mime_type,
                "file_name": sticker.storage_name,
            }
        return self._resolve_sticker_file_payload(payload)

    @staticmethod
    def _preview_mime_type(path: Path) -> str:
        try:
            with path.open("rb") as stream:
                header = stream.read(12)
        except OSError:
            return "application/octet-stream"
        if header.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
            return "image/webp"
        return "application/octet-stream"

    def find_legacy_message_attachment_preview(
        self,
        *,
        session,
        source_path: Path,
        file_name: str,
        mime_type: str,
        file_size: int,
    ) -> dict[str, Any] | None:
        match = _LEGACY_MESSAGE_STICKER_RE.fullmatch(Path(str(file_name or "")).name)
        if match is None or not source_path.is_file():
            return None
        statement = (
            select(ChatSticker, ChatStickerPack)
            .join(ChatStickerPack, ChatStickerPack.id == ChatSticker.pack_id)
            .where(ChatStickerPack.short_name == match.group("pack_short_name"))
        )
        normalized_mime = str(mime_type or "").strip().lower()
        if normalized_mime:
            statement = statement.where(ChatSticker.mime_type == normalized_mime)
        expected_size = max(0, int(file_size or 0))
        if expected_size:
            statement = statement.where(ChatSticker.file_size == expected_size)
        for sticker, pack in session.execute(statement).all():
            original_path = self._storage_root / Path(pack.id).name / Path(sticker.storage_name).name
            preview_path = self._preview_path(pack_id=pack.id, sticker_id=sticker.id)
            try:
                if (
                    original_path.is_file()
                    and preview_path.is_file()
                    and filecmp.cmp(source_path, original_path, shallow=False)
                ):
                    return {
                        "path": str(preview_path),
                        "file_name": preview_path.name,
                        "mime_type": self._preview_mime_type(preview_path),
                    }
            except OSError:
                continue
        return None

    def get_sticker_preview(self, *, current_user_id: int, sticker_id: str) -> dict[str, Any]:
        original = self.get_sticker_file(
            current_user_id=int(current_user_id),
            sticker_id=sticker_id,
        )
        original_path = Path(original["path"])
        preview_path = original_path.parent / self._preview_storage_name(sticker_id)
        if not preview_path.is_file():
            return original
        return {
            **original,
            "path": str(preview_path),
            "file_name": preview_path.name,
            "mime_type": self._preview_mime_type(preview_path),
        }

    def get_pack_sticker_preview(self, *, short_name: str, sticker_id: str) -> dict[str, Any]:
        original = self.get_pack_sticker_file(
            short_name=short_name,
            sticker_id=sticker_id,
        )
        original_path = Path(original["path"])
        preview_path = original_path.parent / self._preview_storage_name(sticker_id)
        if not preview_path.is_file():
            return original
        return {
            **original,
            "path": str(preview_path),
            "file_name": preview_path.name,
            "mime_type": self._preview_mime_type(preview_path),
        }

    def send_sticker(
        self,
        *,
        chat_service,
        current_user_id: int,
        conversation_id: str,
        sticker_id: str,
        reply_to_message_id: str | None = None,
        defer_push_notifications: bool = False,
    ) -> dict[str, Any]:
        chat_service._ensure_available()
        with chat_read_session() as session:
            conversation = chat_service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            row = session.execute(
                select(ChatSticker, ChatStickerPack)
                .join(ChatStickerPack, ChatStickerPack.id == ChatSticker.pack_id)
                .join(ChatUserStickerPack, ChatUserStickerPack.pack_id == ChatStickerPack.id)
                .where(
                    ChatSticker.id == str(sticker_id or "").strip(),
                    ChatUserStickerPack.user_id == int(current_user_id),
                )
            ).first()
            if row is None:
                raise LookupError("Стикер не найден в ваших наборах")
            sticker, pack = row
            normalized_conversation_id = conversation.id
            sticker_snapshot = {
                "id": sticker.id,
                "pack_id": pack.id,
                "pack_short_name": pack.short_name,
                "emoji": sticker.emoji or "",
                "mime_type": sticker.mime_type,
                "storage_name": sticker.storage_name,
                "file_size": int(sticker.file_size or 0),
                "width": sticker.width,
                "height": sticker.height,
            }

        source_root = self._storage_root.resolve()
        source_path = (
            source_root
            / sticker_snapshot["pack_id"]
            / Path(sticker_snapshot["storage_name"]).name
        ).resolve()
        try:
            source_path.relative_to(source_root)
        except ValueError as exc:
            raise ValueError("Некорректный путь стикера") from exc
        if not source_path.exists() or not source_path.is_file():
            raise LookupError("Файл стикера не найден")

        attachment_id = str(uuid4())
        extension = source_path.suffix.lower() or ".bin"
        file_name = (
            f"sticker-{sticker_snapshot['id']}--"
            f"{sticker_snapshot['pack_short_name']}{extension}"
        )
        storage_name = f"{attachment_id}_{file_name}"
        conversation_dir = chat_service._attachments_root / normalized_conversation_id
        conversation_dir.mkdir(parents=True, exist_ok=True)
        target_path = (conversation_dir / storage_name).resolve()
        try:
            target_path.relative_to(chat_service._attachments_root.resolve())
        except ValueError as exc:
            raise ValueError("Некорректный путь вложения") from exc
        shutil.copy2(source_path, target_path)
        prepared = [{
            "attachment_id": attachment_id,
            "storage_name": storage_name,
            "file_name": file_name,
            "mime_type": sticker_snapshot["mime_type"],
            "media_kind": "sticker",
            "file_size": sticker_snapshot["file_size"],
            "width": sticker_snapshot["width"],
            "height": sticker_snapshot["height"],
            "duration_seconds": None,
            "sticker_emoji": sticker_snapshot["emoji"],
            "path": target_path,
        }]
        try:
            persisted = chat_service._file_message_persistence.persist_file_message(
                current_user_id=int(current_user_id),
                conversation_id=normalized_conversation_id,
                body="",
                prepared=prepared,
                reply_to_message_id=reply_to_message_id,
            )
            chat_service._set_request_meta(conversation_kind=persisted.conversation_kind)
        except Exception:
            target_path.unlink(missing_ok=True)
            raise
        chat_service._postprocess_file_message(
            current_user_id=int(current_user_id),
            payload=persisted.payload,
            prepared=prepared,
            body="",
            defer_push_notifications=defer_push_notifications,
        )
        return persisted.payload


telegram_sticker_service = TelegramStickerService()
