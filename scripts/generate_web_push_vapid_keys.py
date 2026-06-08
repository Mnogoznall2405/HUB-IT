#!/usr/bin/env python3
"""Generate a VAPID key pair for WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def generate_vapid_keys() -> tuple[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_num = private_key.private_numbers().private_value.to_bytes(32, "big")
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url(public_bytes), _b64url(private_num)


def main() -> None:
    public_key, private_key = generate_vapid_keys()
    print("Add to .env (keep WEB_PUSH_PRIVATE_KEY secret):")
    print(f"WEB_PUSH_PUBLIC_KEY={public_key}")
    print(f"WEB_PUSH_PRIVATE_KEY={private_key}")
    print("WEB_PUSH_SUBJECT=mailto:it@zsgp.ru")


if __name__ == "__main__":
    main()
