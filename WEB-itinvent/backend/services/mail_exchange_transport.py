"""
Exchange transport helpers for MailService.

This module owns TLS adapter selection and exchangelib account construction,
while MailService keeps the runtime global adapter state for compatibility with
existing tests and lazy exchangelib calls.
"""
from __future__ import annotations

from contextlib import AbstractContextManager
from pathlib import Path
from types import ModuleType
from typing import Any
import warnings as warnings_module


class ExchangeTransportError(RuntimeError):
    """Exchange transport configuration is invalid or exchangelib is unavailable."""


def resolve_tls_ca_bundle(ca_bundle: str) -> str:
    if not ca_bundle:
        return ""
    ca_path = Path(ca_bundle).expanduser()
    if not ca_path.is_file():
        raise ExchangeTransportError(f"MAIL_TLS_CA_BUNDLE points to a missing file: {ca_path}")
    return str(ca_path)


def build_ca_bundle_http_adapter(ca_bundle: str):
    import requests

    class MailCABundleHTTPAdapter(requests.adapters.HTTPAdapter):
        def cert_verify(self, conn, url, verify, cert):
            super().cert_verify(conn=conn, url=url, verify=ca_bundle, cert=cert)

        def get_connection_with_tls_context(self, request, verify, proxies=None, cert=None):
            return super().get_connection_with_tls_context(
                request=request,
                verify=ca_bundle,
                proxies=proxies,
                cert=cert,
            )

    return MailCABundleHTTPAdapter


def get_no_verify_http_adapter():
    try:
        from exchangelib.protocol import NoVerifyHTTPAdapter
        return NoVerifyHTTPAdapter
    except Exception:
        return None


def suppress_insecure_request_warning(*, warnings_api: ModuleType = warnings_module) -> None:
    try:
        from urllib3.exceptions import InsecureRequestWarning
    except Exception:
        return
    warnings_api.filterwarnings("ignore", category=InsecureRequestWarning)


def resolve_exchange_http_adapter(*, verify_tls: bool, ca_bundle: str) -> tuple[tuple[Any, ...], Any | None]:
    if verify_tls:
        resolved_ca_bundle = resolve_tls_ca_bundle(ca_bundle)
        if resolved_ca_bundle:
            return ("ca_bundle", resolved_ca_bundle), build_ca_bundle_http_adapter(resolved_ca_bundle)
        return ("default",), None
    adapter_cls = get_no_verify_http_adapter()
    if adapter_cls is None:
        return ("default",), None
    return ("no_verify",), adapter_cls


def protocol_cache_key(config) -> tuple[Any, ...]:
    """Return exchangelib CachingProtocol key. Do not log or export the key (credentials)."""
    from exchangelib.protocol import CachingProtocol

    return CachingProtocol._cache_key(config)


def inspect_protocol_cache(config) -> dict[str, Any]:
    """Lookup Protocol cache without creating Account or opening NTLM.

    Hit means a live Protocol object is already cached for this endpoint+credentials.
    A cached TransportError is counted as errored, not a hit. Never returns the key.
    """
    try:
        from exchangelib.protocol import CachingProtocol
    except Exception:
        return {"available": False, "hit": False, "size": 0, "errored": False}

    cache = getattr(CachingProtocol, "_protocol_cache", None)
    if cache is None:
        return {"available": False, "hit": False, "size": 0, "errored": False}

    size = len(cache)
    if not getattr(config, "service_endpoint", None) or getattr(config, "credentials", None) is None:
        return {"available": True, "hit": False, "size": size, "errored": False}

    try:
        entry = cache.get(protocol_cache_key(config))
    except Exception:
        return {"available": True, "hit": False, "size": size, "errored": False}

    if entry is None:
        return {"available": True, "hit": False, "size": size, "errored": False}

    protocol = entry[0] if isinstance(entry, (tuple, list)) and entry else entry
    if isinstance(protocol, Exception):
        return {"available": True, "hit": False, "size": size, "errored": True}
    return {"available": True, "hit": True, "size": size, "errored": False}


def _record_protocol_cache_probe(config) -> None:
    try:
        from backend.services.mail_observability import (
            mail_metrics_export_enabled,
            record_mail_protocol_cache,
        )
    except Exception:
        return
    if not mail_metrics_export_enabled():
        return
    try:
        stats = inspect_protocol_cache(config)
    except Exception:
        return
    if not stats.get("available"):
        return
    record_mail_protocol_cache(
        hit=bool(stats.get("hit")),
        errored=bool(stats.get("errored")),
        size=int(stats.get("size") or 0),
    )


def create_exchange_account(
    *,
    email: str,
    login: str,
    password: str,
    ews_url: str,
    exchange_host: str,
    protocol_context: AbstractContextManager[Any],
):
    try:
        from exchangelib import Account, Configuration, Credentials, DELEGATE, NTLM
    except Exception as exc:
        raise ExchangeTransportError("exchangelib package is not installed") from exc

    config_kwargs = {
        "credentials": Credentials(username=login, password=password),
        "auth_type": NTLM,
    }
    if ews_url:
        config_kwargs["service_endpoint"] = ews_url
    else:
        config_kwargs["server"] = exchange_host

    with protocol_context:
        cfg = Configuration(**config_kwargs)
        # Probe cache *before* Account() so miss/hit reflects prior Protocol reuse,
        # not the object we are about to construct. No Account pool is created here.
        _record_protocol_cache_probe(cfg)
        return Account(
            primary_smtp_address=email,
            config=cfg,
            autodiscover=False,
            access_type=DELEGATE,
        )
