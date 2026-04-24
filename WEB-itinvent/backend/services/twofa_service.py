from __future__ import annotations

import base64
import hashlib
import hmac
import io
import os
import secrets
import struct
import time
import urllib.parse
from dataclasses import dataclass
from typing import Iterable
import logging

from backend.config import config
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret


class TwoFactorServiceError(RuntimeError):
    """Domain error for TOTP and backup codes."""


logger = logging.getLogger(__name__)


def _normalize_code(value: str | None) -> str:
    return "".join(ch for ch in str(value or "") if ch.isalnum()).upper()


def _backup_code_pepper() -> bytes:
    raw = str(config.jwt.secret_key or "itinvent-backup-code-pepper").encode("utf-8")
    return hashlib.sha256(raw).digest()


def _base32_secret(length: int = 20) -> str:
    try:
        import pyotp

        return pyotp.random_base32()
    except Exception:
        return base64.b32encode(os.urandom(length)).decode("ascii").rstrip("=")


def _totp_now(secret: str, interval: int = 30, digits: int = 6) -> str:
    normalized = str(secret or "").strip().replace(" ", "").upper()
    if not normalized:
        raise TwoFactorServiceError("TOTP secret is empty")
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    key = base64.b32decode((normalized + padding).encode("ascii"), casefold=True)
    counter = int(time.time() // interval)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10 ** digits)).zfill(digits)


@dataclass
class TotpProvisioning:
    secret: str
    otpauth_uri: str
    qr_svg: str | None


class TwoFactorService:
    """TOTP setup, verification, and backup code lifecycle."""

    def generate_secret(self) -> str:
        return _base32_secret()

    def encrypt_secret(self, secret: str) -> str:
        return encrypt_secret(secret)

    def decrypt_secret(self, encrypted_secret: str | None) -> str:
        return decrypt_secret(encrypted_secret)

    def build_otpauth_uri(self, *, secret: str, username: str, issuer: str | None = None) -> str:
        account_name = urllib.parse.quote(str(username or "").strip(), safe="")
        issuer_name = urllib.parse.quote(str(issuer or config.security.totp_issuer or "HUB-IT").strip(), safe="")
        return f"otpauth://totp/{issuer_name}:{account_name}?secret={secret}&issuer={issuer_name}&digits=6&period=30"

    def build_qr_svg(self, otpauth_uri: str) -> str | None:
        try:
            import qrcode
            from qrcode.image.svg import SvgImage

            stream = io.BytesIO()
            image = qrcode.make(otpauth_uri, image_factory=SvgImage)
            image.save(stream)
            return stream.getvalue().decode("utf-8")
        except Exception:
            logger.warning("TOTP QR SVG generation failed", exc_info=True)
            return None

    def build_provisioning(self, *, username: str, issuer: str | None = None) -> TotpProvisioning:
        secret = self.generate_secret()
        otpauth_uri = self.build_otpauth_uri(secret=secret, username=username, issuer=issuer)
        return TotpProvisioning(
            secret=secret,
            otpauth_uri=otpauth_uri,
            qr_svg=self.build_qr_svg(otpauth_uri),
        )

    def verify_totp(self, *, secret: str, code: str, valid_window: int = 1) -> bool:
        normalized_code = _normalize_code(code)
        if len(normalized_code) < 6:
            return False
        try:
            import pyotp

            totp = pyotp.TOTP(secret)
            return bool(totp.verify(normalized_code, valid_window=max(0, int(valid_window))))
        except Exception:
            current = _totp_now(secret)
            if hmac.compare_digest(current, normalized_code):
                return True
            # Lightweight fallback for +/- one step around clock drift.
            for shift in range(1, max(0, int(valid_window)) + 1):
                try:
                    normalized = str(secret or "").strip().replace(" ", "").upper()
                    padding = "=" * ((8 - len(normalized) % 8) % 8)
                    key = base64.b32decode((normalized + padding).encode("ascii"), casefold=True)
                    for counter in (int(time.time() // 30) - shift, int(time.time() // 30) + shift):
                        msg = struct.pack(">Q", counter)
                        digest = hmac.new(key, msg, hashlib.sha1).digest()
                        offset = digest[-1] & 0x0F
                        binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
                        expected = str(binary % 1_000_000).zfill(6)
                        if hmac.compare_digest(expected, normalized_code):
                            return True
                except Exception:
                    return False
            return False

    def generate_backup_codes(self, count: int | None = None) -> list[str]:
        total = max(1, int(count or config.security.backup_codes_count or 10))
        items: list[str] = []
        seen: set[str] = set()
        while len(items) < total:
            raw = secrets.token_hex(4).upper()
            code = f"{raw[:4]}-{raw[4:]}"
            if code in seen:
                continue
            seen.add(code)
            items.append(code)
        return items

    def hash_backup_code(self, code: str) -> str:
        normalized = _normalize_code(code)
        digest = hmac.new(_backup_code_pepper(), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
        return digest

    def suffix_backup_code(self, code: str) -> str:
        normalized = _normalize_code(code)
        return normalized[-4:] if normalized else ""

    def find_matching_backup_code(self, code: str, rows: Iterable[dict]) -> dict | None:
        target_hash = self.hash_backup_code(code)
        for row in rows or []:
            if hmac.compare_digest(str(row.get("code_hash") or ""), target_hash):
                return row
        return None


twofa_service = TwoFactorService()
