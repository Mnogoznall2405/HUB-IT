"""Private TLS control listener; invoked only by its dedicated PM2 entry."""
from __future__ import annotations

import ipaddress
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'WEB-itinvent'))


def control_options(values: dict[str, str]) -> dict:
    from backend.ai_sandbox.config import validate_transfer_service_token

    host = str(values.get('AI_SANDBOX_CONTROL_BIND_HOST', ''))
    address = ipaddress.ip_address(host)
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified or address.is_link_local:
        raise ValueError('Control requires an explicit private IPv4 interface')
    port = int(values.get('AI_SANDBOX_CONTROL_BIND_PORT', '8443'))
    if not 1024 <= port <= 65535:
        raise ValueError('Invalid private control port')
    validate_transfer_service_token(values.get('AI_SANDBOX_TRANSFER_SERVICE_TOKEN', ''))
    cert = Path(values.get('AI_SANDBOX_CONTROL_TLS_CERT', ''))
    key = Path(values.get('AI_SANDBOX_CONTROL_TLS_KEY', ''))
    if not cert.is_absolute() or not key.is_absolute() or not cert.is_file() or not key.is_file():
        raise ValueError('Control TLS certificate and key are required')
    return {'host': host, 'port': port, 'ssl_certfile': str(cert), 'ssl_keyfile': str(key),
            'proxy_headers': False, 'server_header': False, 'access_log': False}


if __name__ == '__main__':
    from dotenv import load_dotenv
    import uvicorn

    load_dotenv(ROOT / '.env')
    try:
        options = control_options(dict(os.environ))
    except Exception as exc:
        print(f'Sandbox control configuration preflight failed ({type(exc).__name__})', file=sys.stderr)
        raise SystemExit(1)
    uvicorn.run('backend.ai_sandbox_internal_main:app', **options)
