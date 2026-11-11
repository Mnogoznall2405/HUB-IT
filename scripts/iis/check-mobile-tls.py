"""Read-only wire TLS check. Legacy profile cannot fill missing issuers from Windows/AIA."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import socket
import ssl

R3_SHA1 = "d69b561148f01c77c54578c10926df5b856976ad"


def check(host: str, address: str, profile: str, version: ssl.TLSVersion) -> dict:
    result = {"profile": profile, "tls": version.name, "ok": False}
    if profile == "legacy-globalsign-r3":
        # A clean OpenSSL context with exactly R3: no issuer cache, OS roots or AIA downloads.
        pem = Path(__file__).with_name("certs").joinpath("globalsign-root-r3.pem").read_text("ascii")
        der = ssl.PEM_cert_to_DER_cert(pem)
        if hashlib.sha1(der).hexdigest() != R3_SHA1:
            raise ValueError("Unexpected public R3 trust anchor")
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cadata=pem)
    else:
        context = ssl.create_default_context()
    context.minimum_version = context.maximum_version = version
    try:
        with socket.create_connection((address, 443), timeout=8) as tcp:
            with context.wrap_socket(tcp, server_hostname=host) as tls:
                request = (
                    f"GET /api/v1/auth/me HTTP/1.1\r\nHost: {host}\r\n"
                    "User-Agent: HUB-IT-TLS-Compatibility-Check/1.0\r\n"
                    "X-Auth-Client: mobile\r\nConnection: close\r\n\r\n"
                )
                tls.sendall(request.encode("ascii"))
                status_line = tls.makefile("rb").readline(256)
                match = re.fullmatch(rb"HTTP/1\.[01] ([1-5][0-9]{2})(?: [^\r\n]*)?\r\n", status_line)
                status = int(match[1]) if match else None
                cert = tls.getpeercert()
                result.update(
                    certificate_valid=True,
                    leaf_sha256=hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest(),
                    certificate_not_after=cert.get("notAfter"),
                    http_status=status,
                    ok=status == 401,
                    code="ok" if status == 401 else "unexpected_http_status",
                )
    except ssl.SSLCertVerificationError as error:
        result.update(code="certificate_verification_failed", verify_code=error.verify_code)
    except (ssl.SSLError, OSError) as error:
        result.update(code="transport_failed", error_type=type(error).__name__)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="hubit.zsgp.ru")
    parser.add_argument("--connect-address", help="Optional IP of the checked IIS node; SNI/hostname stay --host")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9.-]+", args.host):
        parser.error("--host must contain a DNS hostname only")
    if args.connect_address:
        ipaddress.ip_address(args.connect_address)
    results = [
        check(args.host, args.connect_address or args.host, profile, version)
        for profile in ("system-modern", "legacy-globalsign-r3")
        for version in (ssl.TLSVersion.TLSv1_2, ssl.TLSVersion.TLSv1_3)
    ]
    ok = all(item["ok"] for item in results)
    print(json.dumps({"host": args.host, "ok": ok, "checks": results}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
