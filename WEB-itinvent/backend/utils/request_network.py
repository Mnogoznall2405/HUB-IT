from __future__ import annotations

from dataclasses import dataclass
import ipaddress

from fastapi import Request

from backend.config import config

VALID_2FA_POLICIES = {"off", "all", "external_only"}


@dataclass(frozen=True)
class RequestNetworkContext:
    client_ip: str
    network_zone: str
    via_forwarded_header: bool = False
    trusted_proxy: bool = False


def _parse_ip_literal(value: object):
    raw = str(value or "").strip().strip('"').strip("'")
    if not raw:
        return None
    try:
        return ipaddress.ip_address(raw)
    except ValueError:
        return None


def normalize_ip_value(value: object) -> str:
    raw = str(value or "").strip().strip('"').strip("'")
    if not raw:
        return ""

    bracket_end = raw.find("]")
    if raw.startswith("[") and bracket_end > 1:
        candidate = raw[1:bracket_end].strip()
        parsed = _parse_ip_literal(candidate)
        if parsed is not None:
            return str(parsed)

    parsed = _parse_ip_literal(raw)
    if parsed is not None:
        return str(parsed)

    if raw.count(":") == 1:
        host_part, port_part = raw.rsplit(":", 1)
        if port_part.isdigit():
            parsed = _parse_ip_literal(host_part)
            if parsed is not None:
                return str(parsed)

    return ""


def _coerce_cidr_items(value: object, default: list[str]) -> list[str]:
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, (list, tuple, set)):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        items = []
    return items or list(default)


def _parse_ip(value: object):
    return _parse_ip_literal(normalize_ip_value(value))


def _is_ip_in_cidrs(ip_value: object, cidrs: object, *, default: list[str]) -> bool:
    parsed_ip = _parse_ip(ip_value)
    if parsed_ip is None:
        return False
    for item in _coerce_cidr_items(cidrs, default):
        try:
            if parsed_ip in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


def resolve_twofa_policy() -> str:
    raw_policy = str(config.security.twofa_policy or "").strip().lower()
    if raw_policy in VALID_2FA_POLICIES:
        return raw_policy
    return "all" if bool(config.security.twofa_enforced) else "off"


def classify_network_zone(ip_value: object) -> str:
    if _is_ip_in_cidrs(ip_value, config.security.twofa_internal_cidrs, default=["10.0.0.0/8"]):
        return "internal"
    return "external"


def is_twofa_required_for_zone(network_zone: str, *, policy: str | None = None) -> bool:
    effective_zone = str(network_zone or "").strip().lower()
    effective_policy = str(policy or resolve_twofa_policy()).strip().lower()
    policy_rules = {
        "off": set(),
        "all": {"internal", "external"},
        "external_only": {"external"},
    }
    return effective_zone in policy_rules.get(effective_policy, policy_rules["off"])


def build_request_network_context(request: Request) -> RequestNetworkContext:
    remote_host = ""
    if request.client and request.client.host:
        remote_host = str(request.client.host).strip()
    normalized_remote_host = normalize_ip_value(remote_host)
    trusted_proxy = _is_ip_in_cidrs(
        normalized_remote_host,
        config.security.trusted_proxy_cidrs,
        default=["127.0.0.1/32", "::1/128"],
    )
    forwarded_candidate = ""
    if trusted_proxy:
        forwarded = str(request.headers.get("x-forwarded-for") or "").strip()
        if forwarded:
            for item in forwarded.split(","):
                normalized_item = normalize_ip_value(item)
                if normalized_item:
                    forwarded_candidate = normalized_item
                    break
    client_ip = forwarded_candidate or normalized_remote_host
    return RequestNetworkContext(
        client_ip=str(client_ip or "").strip(),
        network_zone=classify_network_zone(client_ip),
        via_forwarded_header=bool(forwarded_candidate),
        trusted_proxy=trusted_proxy,
    )
