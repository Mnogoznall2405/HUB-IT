"""One-off smoke test: decrypt a single TDEF from Telegram Desktop media_cache.

Read-only on tdata. Does NOT export auth keys / sessions.
Uses empty local passcode (fails clearly if passcode is set).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import struct
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def read_tdf(path: Path) -> tuple[int, bytes]:
    content = path.read_bytes()
    if len(content) < 24 or content[:4] != b"TDF$":
        raise ValueError(f"not a TDF$ file: {path}")
    version = struct.unpack("<I", content[4:8])[0]
    encrypted_data = content[8:-16]
    stored_md5 = content[-16:]
    calculated = hashlib.md5(
        encrypted_data
        + len(encrypted_data).to_bytes(4, "little")
        + version.to_bytes(4, "little")
        + b"TDF$"
    ).digest()
    if calculated != stored_md5:
        raise ValueError(f"TDF$ MD5 mismatch: {path}")
    return version, encrypted_data


class QtDataStreamReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def read_uint32(self) -> int:
        value = struct.unpack_from(">I", self.data, self.offset)[0]
        self.offset += 4
        return value

    def read_bytearray(self) -> bytes | None:
        length = self.read_uint32()
        if length == 0xFFFFFFFF:
            return None
        if length == 0:
            return b""
        value = self.data[self.offset : self.offset + length]
        self.offset += length
        return value


def ige256_decrypt(data: bytes, key: bytes, iv: bytes) -> bytes:
    if len(data) % 16:
        raise ValueError("IGE data length must be multiple of 16")
    if len(key) != 32 or len(iv) != 32:
        raise ValueError("IGE key/iv sizes invalid")
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    iv1 = bytearray(iv[:16])
    iv2 = bytearray(iv[16:])
    out = bytearray()
    for i in range(0, len(data), 16):
        block = data[i : i + 16]
        xored = bytes(a ^ b for a, b in zip(block, iv2))
        plain_aes = decryptor.update(xored)
        plain = bytes(a ^ b for a, b in zip(plain_aes, iv1))
        out.extend(plain)
        iv1[:] = block
        iv2[:] = plain
    decryptor.finalize()
    return bytes(out)


def prepare_aes_oldmtp(auth_key: bytes, msg_key: bytes) -> tuple[bytes, bytes]:
    msg_key = msg_key[:16]
    x = 8
    sha1_a = hashlib.sha1(msg_key + auth_key[x : x + 32]).digest()
    sha1_b = hashlib.sha1(
        auth_key[x + 32 : x + 48] + msg_key + auth_key[x + 48 : x + 64]
    ).digest()
    sha1_c = hashlib.sha1(auth_key[x + 64 : x + 96] + msg_key).digest()
    sha1_d = hashlib.sha1(msg_key + auth_key[x + 96 : x + 128]).digest()
    aes_key = sha1_a[0:8] + sha1_b[8:20] + sha1_c[4:16]
    aes_iv = sha1_a[8:20] + sha1_b[0:8] + sha1_c[16:20] + sha1_d[0:8]
    return aes_key, aes_iv


def decrypt_tdf_legacy(encrypted_data: bytes, auth_key: bytes) -> bytes:
    msg_key = encrypted_data[:16]
    payload = encrypted_data[16:]
    aes_key, aes_iv = prepare_aes_oldmtp(auth_key, msg_key)
    decrypted = ige256_decrypt(payload, aes_key, aes_iv)
    if hashlib.sha1(decrypted).digest()[:16] != msg_key:
        raise ValueError(
            "IGE checksum mismatch (wrong passcode or unsupported key format)"
        )
    length = int.from_bytes(decrypted[:4], "little")
    if length > len(decrypted) - 4:
        raise ValueError(f"bad decrypted length: {length}")
    return decrypted[4:length]


def create_local_key(passcode: str, salt: bytes, tdesktop_version: int) -> bytes:
    # Matches modern tdesktop (version >= 2001014) and older fallback.
    if tdesktop_version < 2001014:
        if not passcode:
            return hashlib.pbkdf2_hmac("sha1", b"", salt, 4, 136)
        return hashlib.pbkdf2_hmac("sha1", passcode.encode("utf-8"), salt, 4000, 136)
    if not passcode:
        pass_hash = hashlib.sha512(salt + salt).digest()
        return hashlib.pbkdf2_hmac("sha512", pass_hash, salt, 1, 136)
    passcode_bytes = passcode.encode("utf-8")
    pass_hash = hashlib.sha512(salt + passcode_bytes + salt).digest()
    return hashlib.pbkdf2_hmac("sha512", pass_hash, salt, 100000, 136)


def get_local_key(tdata: Path, passcode: str = "") -> tuple[bytes, int]:
    version, data = read_tdf(tdata / "key_datas")
    reader = QtDataStreamReader(data)
    salt = reader.read_bytearray()
    key_encrypted = reader.read_bytearray()
    _info_encrypted = reader.read_bytearray()
    if salt is None or key_encrypted is None:
        raise ValueError("invalid key_datas payload")
    pass_key = create_local_key(passcode, salt, version)
    local_key = decrypt_tdf_legacy(key_encrypted, pass_key)
    return local_key, version


def decrypt_tdef(path: Path, local_key: bytes) -> bytes:
    raw = path.read_bytes()
    if raw[:4] != b"TDEF":
        raise ValueError(f"not TDEF: {path}")
    salt = raw[4:68]
    encrypted = raw[68:]
    if len(encrypted) < 48:
        raise ValueError("TDEF too short")
    # local_key may be 256; half-split matches tdesktop / TGArtifacts
    half = len(local_key) // 2
    real_key = hashlib.sha256(local_key[:half] + salt[:32]).digest()
    iv = hashlib.sha256(local_key[half:] + salt[32:64]).digest()[:16]
    decryptor = Cipher(algorithms.AES(real_key), modes.CTR(iv)).decryptor()
    decrypted_all = decryptor.update(encrypted) + decryptor.finalize()
    header = decrypted_all[:48]
    body = decrypted_all[48:]
    data_part = header[:16]
    stored_checksum = header[16:48]
    expected = hashlib.sha256(local_key + salt + data_part).digest()
    if stored_checksum != expected:
        raise ValueError("TDEF checksum mismatch")
    return body


def sniff_type(data: bytes) -> str:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:8] == b"ftyp":
        return "mp4"
    if data.startswith(b"GIF8"):
        return "gif"
    # streaming cache header: little-endian part count
    if len(data) >= 4:
        count = int.from_bytes(data[:4], "little")
        if 0 < count < 1000:
            return f"streaming_or_unknown(count={count})"
    return f"unknown(magic={data[:16].hex()})"


def default_tdata() -> Path:
    appdata = os.environ.get("APPDATA") or ""
    return Path(appdata) / "Telegram Desktop" / "tdata"


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-decrypt one TDEF media file")
    parser.add_argument("--tdata", type=Path, default=default_tdata())
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "output" / "media_smoke",
    )
    parser.add_argument("--passcode", default="", help="local Telegram passcode if set")
    args = parser.parse_args()

    tdata: Path = args.tdata
    media_cache = tdata / "user_data" / "media_cache"
    if not (tdata / "key_datas").is_file():
        print(f"FAIL: key_datas not found under {tdata}", file=sys.stderr)
        return 1
    if not media_cache.is_dir():
        print(f"FAIL: media_cache not found: {media_cache}", file=sys.stderr)
        return 1

    candidates = sorted(
        (p for p in media_cache.rglob("*") if p.is_file()),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    if not candidates:
        print("FAIL: media_cache is empty", file=sys.stderr)
        return 1

    print(f"tdata: {tdata}")
    print(f"candidates: {len(candidates)}")
    try:
        local_key, key_version = get_local_key(tdata, args.passcode)
    except ValueError as exc:
        print(f"FAIL: cannot derive local key: {exc}", file=sys.stderr)
        print(
            "Hint: if Telegram has a local passcode, re-run with --passcode",
            file=sys.stderr,
        )
        return 2

    # Never print key material — only length / version.
    print(f"local_key_ok: len={len(local_key)} key_datas_version={key_version}")

    # Prefer a non-binlog cache file; skip locked binlog if present.
    candidates = [p for p in candidates if p.name != "binlog"]
    target = candidates[0]
    print(f"decrypting: {target} ({target.stat().st_size} bytes)")
    try:
        plain = decrypt_tdef(target, local_key)
    except Exception as exc:  # noqa: BLE001 — smoke report
        print(f"FAIL: decrypt: {exc}", file=sys.stderr)
        return 3

    # Simple single-slice streaming reassembly (videos / large media).
    assembled = None
    if len(plain) >= 4:
        count = int.from_bytes(plain[:4], "little")
        if 0 < count < 1000:
            pos = 4
            parts: list[tuple[int, bytes]] = []
            ok = True
            for _ in range(count):
                if pos + 8 > len(plain):
                    ok = False
                    break
                offset = int.from_bytes(plain[pos : pos + 4], "little")
                size = int.from_bytes(plain[pos + 4 : pos + 8], "little")
                pos += 8
                if size == 0 or pos + size > len(plain):
                    ok = False
                    break
                parts.append((offset, plain[pos : pos + size]))
                pos += size
            if ok and parts:
                end = max(o + len(b) for o, b in parts)
                buf = bytearray(end)
                for o, b in parts:
                    buf[o : o + len(b)] = b
                assembled = bytes(buf)

    final = assembled if assembled is not None else plain
    kind = sniff_type(final)
    ext = kind.split("(")[0]
    if ext.startswith("streaming") or ext.startswith("unknown"):
        ext = "bin"
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / f"{target.name}.{ext}"
    out_path.write_bytes(final)
    print(
        f"OK: type={kind} size={len(final)} streaming={assembled is not None} -> {out_path}"
    )
    print(f"head_hex={final[:32].hex()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
