#!/usr/bin/env python3
"""Pack a Chromium MV3 extension directory into a CRX3 (.crx) file."""

from __future__ import annotations

import argparse
import hashlib
import io
import struct
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

CRX_MAGIC = b"Cr24"
CRX_VERSION = 3
SIGNED_DATA_CONTEXT = b"CRX3 SignedData\x00"


def _pb_varint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value & 0x7F)
    return bytes(out)


def _pb_bytes(field: int, data: bytes) -> bytes:
    return _pb_varint((field << 3) | 2) + _pb_varint(len(data)) + data


def _pb_message(field: int, data: bytes) -> bytes:
    return _pb_bytes(field, data)


def _zip_extension(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src.rglob("*")):
            if not path.is_file():
                continue
            if path.name in {"key.pem", "manifest_key.txt", "extension_id.txt"}:
                continue
            arc = path.relative_to(src).as_posix()
            zf.write(path, arcname=arc)
    return buf.getvalue()


def pack_crx3(*, extension_dir: Path, private_key_pem: Path, output_crx: Path) -> Path:
    private_key = serialization.load_pem_private_key(
        private_key_pem.read_bytes(),
        password=None,
    )
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    crx_id = hashlib.sha256(public_key).digest()[:16]
    signed_header = _pb_bytes(1, crx_id)  # SignedData.crx_id
    zip_data = _zip_extension(extension_dir)

    signed_header_size = struct.pack("<I", len(signed_header))
    to_sign = SIGNED_DATA_CONTEXT + signed_header_size + signed_header + zip_data
    signature = private_key.sign(to_sign, padding.PKCS1v15(), hashes.SHA256())

    proof = _pb_bytes(1, public_key) + _pb_bytes(2, signature)  # AsymmetricKeyProof
    header = (
        _pb_message(2, proof)  # CrxFileHeader.sha256_with_rsa
        + _pb_bytes(100, signed_header)  # CrxFileHeader.signed_header_data
    )

    output_crx.parent.mkdir(parents=True, exist_ok=True)
    with output_crx.open("wb") as fh:
        fh.write(CRX_MAGIC)
        fh.write(struct.pack("<I", CRX_VERSION))
        fh.write(struct.pack("<I", len(header)))
        fh.write(header)
        fh.write(zip_data)
    return output_crx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_dir", type=Path)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()
    out = pack_crx3(
        extension_dir=args.extension_dir.resolve(),
        private_key_pem=args.key.resolve(),
        output_crx=args.output.resolve(),
    )
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
