"""LDAP transport security for all directory connections.

Every ``Server``/``Connection`` in the codebase goes through this module so
domain credentials (user logins and the sync service account) are never sent
over plaintext LDAP.

Modes via ``LDAP_SECURITY``:
  ``ldaps``    — TLS on connect to port 636 (default).
  ``starttls`` — StartTLS upgrade on 389 before bind.
  ``none``     — plaintext; explicit local debugging only, logs a warning.

Certificate identity is validated against ``LDAP_TLS_VALID_NAMES`` (the DC
certificate's CN/SAN names), which lets an IP-based ``LDAP_SERVER`` verify
correctly; the CA chain is checked against the system trust store or
``LDAP_TLS_CA_FILE`` when provided.
"""

from __future__ import annotations

import logging
import os
import ssl
from typing import List, Optional

from ldap3 import ALL, Connection, Server, Tls
from ldap3.core.exceptions import LDAPExceptionError

logger = logging.getLogger(__name__)

# Deployment default: certificate SAN of the domain controller reachable at
# the built-in LDAP_SERVER default (10.103.0.150).
_DEFAULT_TLS_VALID_NAMES = "TMN-SRV-DC-01.zsgp.corp"

_INSECURE_MODES = {"none", "plain", "plaintext", "off", "insecure"}


def ldap_security_mode() -> str:
    mode = str(os.getenv("LDAP_SECURITY", "ldaps") or "ldaps").strip().lower()
    return mode if mode in {"ldaps", "starttls"} | _INSECURE_MODES else "ldaps"


def _tls_valid_names() -> List[str]:
    raw = os.getenv("LDAP_TLS_VALID_NAMES", _DEFAULT_TLS_VALID_NAMES)
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]


def build_ldap_server(host: str) -> Server:
    """Build a ``Server`` honoring ``LDAP_SECURITY`` (LDAPS by default)."""
    host = str(host or "").strip()
    mode = ldap_security_mode()
    if mode in _INSECURE_MODES:
        logger.warning("LDAP_SECURITY=%s: directory traffic is NOT encrypted", mode)
        return Server(host, get_info=ALL)
    valid_names = _tls_valid_names()
    tls = Tls(
        validate=ssl.CERT_REQUIRED,
        ca_certs_file=str(os.getenv("LDAP_TLS_CA_FILE", "") or "").strip() or None,
        sni=(valid_names[0] if valid_names else None),
        valid_names=valid_names or None,
    )
    if mode == "starttls":
        return Server(host, get_info=ALL, tls=tls)
    return Server(host, port=636, use_ssl=True, get_info=ALL, tls=tls)


def open_ldap_connection(host: str, *, user: str = "", password: str = "") -> Connection:
    """Open a bound LDAP connection; TLS is negotiated before any bind."""
    server = build_ldap_server(host)
    credentials = {"user": user, "password": password} if user else {}
    if ldap_security_mode() == "starttls":
        conn = Connection(server, **credentials)
        conn.open()
        if not conn.start_tls():
            conn.unbind()
            raise LDAPExceptionError("LDAP StartTLS negotiation failed")
        if not conn.bind():
            result = getattr(conn, "result", None) or {}
            raise LDAPExceptionError(
                f"LDAP bind failed after StartTLS: {result.get('description') or 'unknown'}"
            )
        return conn
    return Connection(server, auto_bind=True, **credentials)
