from __future__ import annotations

import logging
import math
import re
import socket
import ssl
import subprocess
import time
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    NETWORK_TOOL_SOCKET_SEARCH,
    NETWORK_TOOL_BRANCH_OVERVIEW,
    NETWORK_TOOL_PORTS_SEARCH,
    NETWORK_TOOL_HOST_PING,
    NETWORK_TOOL_DNS_LOOKUP,
    NETWORK_TOOL_SSL_CHECK,
    NETWORK_TOOL_ACTION_WOL_DRAFT,
    NETWORK_TOOL_HOST_INFO,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.services.network_service import network_service


logger = logging.getLogger(__name__)


DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value if value is not None else "").strip()
    return text or default


def _to_int(value: object) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _find_branch_id(query: str) -> int | None:
    text = _normalize_text(query).lower()
    if not text:
        return None
    int_id = _to_int(query)
    if int_id is not None:
        return int_id
    try:
        with network_service._lock, network_service._connect() as conn:
            rows = conn.execute(
                "SELECT id FROM network_branches WHERE LOWER(name) LIKE ? OR LOWER(branch_code) LIKE ? LIMIT 1",
                (f"%{text}%", f"%{text}%"),
            ).fetchall()
            if rows:
                return int(rows[0]["id"])
    except Exception:
        pass
    return None


class NetworkSocketSearchArgs(BaseModel):
    branch_id: Optional[int] = Field(default=None, ge=1)
    branch_query: Optional[str] = Field(default=None, max_length=180)
    search: Optional[str] = Field(default=None, max_length=120)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)

    @field_validator("branch_query", "search", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class NetworkBranchOverviewArgs(BaseModel):
    branch_id: Optional[int] = Field(default=None, ge=1)
    branch_query: Optional[str] = Field(default=None, max_length=180)

    @field_validator("branch_query", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class NetworkPortsSearchArgs(BaseModel):
    branch_id: Optional[int] = Field(default=None, ge=1)
    branch_query: Optional[str] = Field(default=None, max_length=180)
    search: Optional[str] = Field(default=None, max_length=120)
    vlan: Optional[str] = Field(default=None, max_length=80)
    occupied: Optional[bool] = None
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)

    @field_validator("branch_query", "search", "vlan", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


def _resolve_branch_id(branch_id: int | None, branch_query: str | None) -> int | None:
    if branch_id is not None:
        return branch_id
    if branch_query:
        return _find_branch_id(branch_query)
    return None


class NetworkSocketSearchTool(AiTool):
    tool_id = NETWORK_TOOL_SOCKET_SEARCH
    description = (
        "Search network patch-panel sockets in a branch. "
        "Provide branch_id or branch_query (branch name/code) and optional search string "
        "(socket code, MAC, FIO, VLAN, IP, port). Returns matched sockets with patch panel info."
    )
    input_model = NetworkSocketSearchArgs
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkSocketSearchArgs) -> AiToolResult:
        branch_id = _resolve_branch_id(args.branch_id, args.branch_query)
        if not branch_id:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Provide branch_id or branch_query to identify the branch.",
            )
        try:
            rows = network_service.list_sockets(
                branch_id,
                search=_normalize_text(args.search),
                limit=max(1, min(args.limit, MAX_LIMIT)),
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))

        items = [dict(row) for row in (rows or []) if isinstance(row, dict)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "branch_id": branch_id,
                "search": args.search,
                "count": len(items),
                "truncated": len(items) >= args.limit,
                "items": items,
            },
        )


class NetworkBranchOverviewTool(AiTool):
    tool_id = NETWORK_TOOL_BRANCH_OVERVIEW
    description = (
        "Get an overview of a network branch: device count, port count, occupied ports, "
        "sockets count, sites. Provide branch_id or branch_query."
    )
    input_model = NetworkBranchOverviewArgs
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkBranchOverviewArgs) -> AiToolResult:
        branch_id = _resolve_branch_id(args.branch_id, args.branch_query)
        if not branch_id:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Provide branch_id or branch_query to identify the branch.",
            )
        try:
            overview = network_service.get_branch_overview(branch_id)
        except ValueError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data=overview,
        )


class NetworkPortsSearchTool(AiTool):
    tool_id = NETWORK_TOOL_PORTS_SEARCH
    description = (
        "Search network switch ports in a branch. "
        "Provide branch_id or branch_query, optional search string (device code, port name, endpoint IP/MAC, socket code, FIO), "
        "optional vlan filter, optional occupied filter. Returns matched ports."
    )
    input_model = NetworkPortsSearchArgs
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkPortsSearchArgs) -> AiToolResult:
        branch_id = _resolve_branch_id(args.branch_id, args.branch_query)
        if not branch_id:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Provide branch_id or branch_query to identify the branch.",
            )
        try:
            rows = network_service.list_ports_by_branch(
                branch_id,
                search=_normalize_text(args.search),
                vlan=_normalize_text(args.vlan),
                occupied=args.occupied,
                limit=max(1, min(args.limit, MAX_LIMIT)),
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))

        items = [dict(row) for row in (rows or []) if isinstance(row, dict)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "branch_id": branch_id,
                "search": args.search,
                "vlan": args.vlan,
                "occupied": args.occupied,
                "count": len(items),
                "truncated": len(items) >= args.limit,
                "items": items,
            },
        )


# ---------------------------------------------------------------------------
# Ping Tool
# ---------------------------------------------------------------------------


class NetworkHostPingArgs(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    count: int = Field(default=4, ge=1, le=10)


def parse_ping_output(output: str) -> dict[str, Any]:
    """Parse Windows ping command output and extract structured results.

    Returns dict with keys: reachable, response_time_ms, packet_loss_percent, resolved_ip.
    """
    result: dict[str, Any] = {
        "reachable": False,
        "response_time_ms": None,
        "packet_loss_percent": 100,
        "resolved_ip": None,
    }

    # Extract resolved IP from "Pinging <host> [<ip>]" or "Pinging <ip> with ..."
    ip_bracket_match = re.search(r"Pinging\s+\S+\s+\[([^\]]+)\]", output)
    if ip_bracket_match:
        result["resolved_ip"] = ip_bracket_match.group(1)
    else:
        # Direct IP ping: "Pinging 192.168.1.1 with 32 bytes of data:"
        ip_direct_match = re.search(
            r"Pinging\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+with", output
        )
        if ip_direct_match:
            result["resolved_ip"] = ip_direct_match.group(1)

    # Extract packet loss percentage
    # English: "(0% loss)" or "(100% loss)"
    loss_match = re.search(r"\((\d+)%\s*(?:loss|потерь)", output)
    if loss_match:
        result["packet_loss_percent"] = int(loss_match.group(1))
    else:
        # Russian: "Потеряно = 4 (100% потерь)" or "Потеряно = 0 (0% потерь)"
        loss_ru_match = re.search(r"(\d+)%", output)
        if loss_ru_match:
            result["packet_loss_percent"] = int(loss_ru_match.group(1))

    # Determine reachability
    result["reachable"] = result["packet_loss_percent"] < 100

    # Extract average response time
    # English: "Average = 5ms"
    avg_match = re.search(r"Average\s*=\s*(\d+)\s*ms", output, re.IGNORECASE)
    if avg_match:
        result["response_time_ms"] = int(avg_match.group(1))
    else:
        # Russian: "Среднее = 5 мсек"
        avg_ru_match = re.search(r"Среднее\s*=\s*(\d+)\s*мсек", output)
        if avg_ru_match:
            result["response_time_ms"] = int(avg_ru_match.group(1))
        else:
            # Fallback: try to get from "Minimum = Xms, Maximum = Yms, Average = Zms"
            avg_fallback = re.search(r"(?:Average|Среднее)\s*=\s*(\d+)", output)
            if avg_fallback:
                result["response_time_ms"] = int(avg_fallback.group(1))

    return result


class NetworkHostPingTool(AiTool):
    tool_id = NETWORK_TOOL_HOST_PING
    description = (
        "Ping a network host by hostname or IP address to check availability. "
        "Returns reachable status, response time, packet loss percentage, and resolved IP. "
        "Use count parameter (1–10, default 4) to control number of ping packets. "
        "IMPORTANT: If the user asks to ping a person's computer (e.g. 'пингани комп Кошкиной'), "
        "first use itinvent.user.computer to find their computer — it returns network_name and ip_address. "
        "If network_name or ip_address is present in the result, use it directly as the host parameter. "
        "If neither is available, try itinvent.equipment.online_status with the hostname to get agent data. "
        "Do NOT ping by inventory number — use hostname or IP only."
    )
    input_model = NetworkHostPingArgs
    admin_only = False
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkHostPingArgs) -> AiToolResult:
        host = args.host.strip()
        count = args.count

        try:
            proc = subprocess.run(
                ["ping", "-n", str(count), "-w", "1000", host],
                timeout=5,
                capture_output=True,
                text=True,
                encoding="cp866",
                errors="replace",
            )
            output = (proc.stdout or "") + "\n" + (proc.stderr or "")
        except subprocess.TimeoutExpired:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={
                    "host": host,
                    "count": count,
                    "reachable": False,
                    "response_time_ms": None,
                    "packet_loss_percent": 100,
                    "resolved_ip": None,
                    "error": "Command timed out after 5s",
                },
            )
        except FileNotFoundError:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="ping command not found on this system.",
            )
        except Exception as exc:
            logger.warning("network.host.ping failed host=%s error=%s", host, exc)
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Ping execution failed: {exc}",
            )

        # Check for DNS resolution failure
        dns_fail_patterns = [
            "could not find host",
            "Ping request could not find host",
            "не удалось обнаружить узел",
            "не удается найти узел",
        ]
        output_lower = output.lower()
        for pattern in dns_fail_patterns:
            if pattern.lower() in output_lower:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=True,
                    data={
                        "host": host,
                        "count": count,
                        "reachable": False,
                        "response_time_ms": None,
                        "packet_loss_percent": 100,
                        "resolved_ip": None,
                        "error": "DNS resolution failed",
                    },
                )

        parsed = parse_ping_output(output)

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "host": host,
                "count": count,
                "reachable": parsed["reachable"],
                "response_time_ms": parsed["response_time_ms"],
                "packet_loss_percent": parsed["packet_loss_percent"],
                "resolved_ip": parsed["resolved_ip"],
            },
        )


# ---------------------------------------------------------------------------
# DNS Lookup Tool
# ---------------------------------------------------------------------------

_VALID_RECORD_TYPES = {"A", "AAAA", "MX", "CNAME", "PTR", "TXT", "NS"}


class NetworkDnsLookupArgs(BaseModel):
    query: str = Field(..., min_length=1, max_length=253)
    record_type: str = Field(default="A", pattern=r"^(A|AAAA|MX|CNAME|PTR|TXT|NS)$")


def _dns_lookup_dnspython(query: str, record_type: str) -> dict[str, Any]:
    """Perform DNS lookup using dnspython library.

    Returns dict with records list, ttl, and resolved_in_ms.
    Raises Exception on failure.
    """
    import dns.resolver
    import dns.rdatatype
    import dns.name

    start = time.perf_counter()
    resolver = dns.resolver.Resolver()
    resolver.timeout = 5
    resolver.lifetime = 5

    answer = resolver.resolve(query, record_type)
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    records: list[str] = []
    ttl = int(answer.rrset.ttl) if answer.rrset else 0

    for rdata in answer:
        if record_type == "MX":
            records.append(f"{rdata.preference} {rdata.exchange}")
        elif record_type == "TXT":
            # TXT records may have multiple strings
            txt_parts = [part.decode("utf-8", errors="replace") if isinstance(part, bytes) else str(part) for part in rdata.strings]
            records.append(" ".join(txt_parts))
        else:
            records.append(str(rdata))

    return {
        "records": records,
        "ttl": ttl,
        "resolved_in_ms": elapsed_ms,
    }


def _dns_lookup_nslookup(query: str, record_type: str) -> dict[str, Any]:
    """Fallback DNS lookup using nslookup subprocess.

    Returns dict with records list, ttl (0 since nslookup doesn't reliably report it),
    and resolved_in_ms.
    Raises Exception on failure.
    """
    # Build nslookup command
    # nslookup -type=<record_type> <query>
    cmd = ["nslookup", f"-type={record_type}", query]

    start = time.perf_counter()
    proc = subprocess.run(
        cmd,
        timeout=10,
        capture_output=True,
        text=True,
        encoding="cp866",
        errors="replace",
    )
    elapsed_ms = int((time.perf_counter() - start) * 1000)

    output = (proc.stdout or "") + "\n" + (proc.stderr or "")

    # Check for common failure patterns
    output_lower = output.lower()
    if "can't find" in output_lower or "non-existent domain" in output_lower:
        raise Exception(f"DNS query failed: domain '{query}' not found")
    if "server failed" in output_lower:
        raise Exception(f"DNS server failed to resolve '{query}'")
    if "timed out" in output_lower or "timeout" in output_lower:
        raise Exception(f"DNS query timed out for '{query}'")

    # Parse nslookup output for records
    records: list[str] = []
    lines = output.splitlines()

    # Skip the first "Server:" and "Address:" lines (DNS server info)
    in_answer_section = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_answer_section:
                continue
            in_answer_section = True
            continue

        if not in_answer_section:
            continue

        # Parse based on record type
        if record_type == "A" or record_type == "AAAA":
            # Look for "Address: <ip>" or "Addresses: <ip>"
            addr_match = re.search(r"(?:Address|Addresses)\s*[:=]\s*(.+)", stripped)
            if addr_match:
                addr = addr_match.group(1).strip()
                # Skip the DNS server address (usually the first one)
                if addr and addr not in records:
                    records.append(addr)
            # Also look for "Internet address = <ip>"
            inet_match = re.search(r"internet address\s*=\s*(.+)", stripped, re.IGNORECASE)
            if inet_match:
                addr = inet_match.group(1).strip()
                if addr and addr not in records:
                    records.append(addr)
        elif record_type == "MX":
            mx_match = re.search(r"mail exchanger\s*=\s*(.+)", stripped, re.IGNORECASE)
            if mx_match:
                records.append(mx_match.group(1).strip())
            else:
                pref_match = re.search(r"MX preference\s*=\s*(\d+).*mail exchanger\s*=\s*(.+)", stripped, re.IGNORECASE)
                if pref_match:
                    records.append(f"{pref_match.group(1)} {pref_match.group(2).strip()}")
        elif record_type == "CNAME":
            cname_match = re.search(r"canonical name\s*=\s*(.+)", stripped, re.IGNORECASE)
            if cname_match:
                records.append(cname_match.group(1).strip())
        elif record_type == "NS":
            ns_match = re.search(r"nameserver\s*=\s*(.+)", stripped, re.IGNORECASE)
            if ns_match:
                records.append(ns_match.group(1).strip())
        elif record_type == "TXT":
            txt_match = re.search(r"text\s*=\s*(.+)", stripped, re.IGNORECASE)
            if txt_match:
                txt_val = txt_match.group(1).strip().strip('"')
                records.append(txt_val)
        elif record_type == "PTR":
            ptr_match = re.search(r"name\s*=\s*(.+)", stripped, re.IGNORECASE)
            if ptr_match:
                records.append(ptr_match.group(1).strip())

    return {
        "records": records,
        "ttl": 0,
        "resolved_in_ms": elapsed_ms,
    }


class NetworkDnsLookupTool(AiTool):
    tool_id = NETWORK_TOOL_DNS_LOOKUP
    description = (
        "Perform a DNS lookup for a hostname or IP address. "
        "Supports record types: A, AAAA, MX, CNAME, PTR, TXT, NS. "
        "Returns resolved records, TTL, and resolution time."
    )
    input_model = NetworkDnsLookupArgs
    admin_only = False
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkDnsLookupArgs) -> AiToolResult:
        query = args.query.strip()
        record_type = args.record_type.upper()

        if record_type not in _VALID_RECORD_TYPES:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Invalid record_type '{record_type}'. Must be one of: {', '.join(sorted(_VALID_RECORD_TYPES))}",
            )

        # Try dnspython first, fallback to nslookup
        try:
            result = _dns_lookup_dnspython(query, record_type)
        except ImportError:
            # dnspython not installed, use nslookup fallback
            logger.info("dnspython not available, falling back to nslookup for %s", query)
            try:
                result = _dns_lookup_nslookup(query, record_type)
            except subprocess.TimeoutExpired:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"DNS query timed out after 10s for '{query}' ({record_type}).",
                )
            except Exception as exc:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"DNS lookup failed for '{query}' ({record_type}): {exc}",
                )
        except Exception as exc:
            # dnspython failed, try nslookup fallback
            logger.info("dnspython failed for %s (%s): %s, trying nslookup", query, record_type, exc)
            try:
                result = _dns_lookup_nslookup(query, record_type)
            except subprocess.TimeoutExpired:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"DNS query timed out after 10s for '{query}' ({record_type}).",
                )
            except Exception as fallback_exc:
                # Both methods failed - return the original dnspython error
                error_msg = str(exc)
                # Make error messages more user-friendly
                if "NXDOMAIN" in error_msg or "does not exist" in error_msg.lower():
                    error_msg = f"Domain '{query}' does not exist (NXDOMAIN)"
                elif "NoAnswer" in error_msg or "no answer" in error_msg.lower():
                    error_msg = f"No {record_type} records found for '{query}'"
                elif "Timeout" in error_msg or "timed out" in error_msg.lower():
                    error_msg = f"DNS query timed out for '{query}'"
                elif "NoNameservers" in error_msg:
                    error_msg = f"No DNS nameservers available to resolve '{query}'"
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"DNS lookup failed for '{query}' ({record_type}): {error_msg}",
                )

        records = result.get("records", [])
        ttl = result.get("ttl", 0)
        resolved_in_ms = result.get("resolved_in_ms", 0)

        # If no records found, return with descriptive message
        if not records:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={
                    "query": query,
                    "record_type": record_type,
                    "records": [],
                    "ttl": 0,
                    "resolved_in_ms": resolved_in_ms,
                    "error": f"No {record_type} records found for '{query}'",
                },
            )

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "query": query,
                "record_type": record_type,
                "records": records,
                "ttl": ttl,
                "resolved_in_ms": resolved_in_ms,
            },
        )


# ---------------------------------------------------------------------------
# SSL Certificate Check Tool
# ---------------------------------------------------------------------------


class NetworkSslCheckArgs(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=253)
    port: int = Field(default=443, ge=1, le=65535)


def compute_days_until_expiry(valid_until: datetime, now: datetime | None = None) -> int:
    """Compute days until certificate expiry.

    Returns ceil((valid_until - now).total_seconds() / 86400) when valid_until > now,
    and 0 otherwise.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    # Ensure both are timezone-aware for comparison
    if valid_until.tzinfo is None:
        valid_until = valid_until.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    diff = valid_until - now
    total_seconds = diff.total_seconds()
    if total_seconds <= 0:
        return 0
    return math.ceil(total_seconds / 86400)


def _parse_cert_time(time_str: str) -> datetime | None:
    """Parse certificate time string from getpeercert() format.

    Format: 'Mon DD HH:MM:SS YYYY GMT' (e.g., 'Jan  5 12:00:00 2025 GMT')
    """
    if not time_str:
        return None
    try:
        return datetime.strptime(time_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _extract_cert_field(cert_tuple: tuple | None) -> str:
    """Extract a human-readable string from a certificate subject/issuer tuple.

    The cert tuple is like: ((('commonName', 'example.com'),), (('organizationName', 'Org'),))
    """
    if not cert_tuple:
        return ""
    parts = []
    for rdn in cert_tuple:
        if isinstance(rdn, tuple):
            for attr_pair in rdn:
                if isinstance(attr_pair, tuple) and len(attr_pair) == 2:
                    parts.append(f"{attr_pair[0]}={attr_pair[1]}")
    return ", ".join(parts)


class NetworkSslCheckTool(AiTool):
    tool_id = NETWORK_TOOL_SSL_CHECK
    description = (
        "Check SSL/TLS certificate status for a hostname. "
        "Returns certificate details: issuer, subject, validity dates, days until expiry, "
        "and whether the certificate is valid. "
        "Use to verify SSL certificates on internal and external services."
    )
    input_model = NetworkSslCheckArgs
    admin_only = False
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkSslCheckArgs) -> AiToolResult:
        hostname = args.hostname.strip()
        port = args.port

        ctx = ssl.create_default_context()

        try:
            with socket.create_connection((hostname, port), timeout=10) as sock:
                with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                    cert = ssock.getpeercert()

            if not cert:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=True,
                    data={
                        "hostname": hostname,
                        "port": port,
                        "is_valid": False,
                        "error": "No certificate returned by server.",
                    },
                )

            # Extract certificate fields
            issuer = _extract_cert_field(cert.get("issuer"))
            subject = _extract_cert_field(cert.get("subject"))
            valid_from_str = cert.get("notBefore", "")
            valid_until_str = cert.get("notAfter", "")
            serial_number = cert.get("serialNumber", "")

            valid_from = _parse_cert_time(valid_from_str)
            valid_until = _parse_cert_time(valid_until_str)

            now = datetime.now(timezone.utc)
            days_until_expiry = 0
            is_valid = True

            if valid_from and valid_until:
                days_until_expiry = compute_days_until_expiry(valid_until, now)
                # Certificate is valid if current time is within validity period
                is_valid = valid_from <= now <= valid_until
            elif valid_until:
                days_until_expiry = compute_days_until_expiry(valid_until, now)
                is_valid = now <= valid_until
            else:
                is_valid = False

            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={
                    "hostname": hostname,
                    "port": port,
                    "issuer": issuer,
                    "subject": subject,
                    "valid_from": valid_from.isoformat() if valid_from else None,
                    "valid_until": valid_until.isoformat() if valid_until else None,
                    "days_until_expiry": days_until_expiry,
                    "is_valid": is_valid,
                    "serial_number": serial_number,
                },
            )

        except ssl.SSLCertVerificationError as exc:
            # Handle expired, self-signed, hostname mismatch
            error_msg = str(exc)
            error_detail = "Certificate verification failed"
            if "expired" in error_msg.lower():
                error_detail = "Certificate has expired"
            elif "self-signed" in error_msg.lower() or "self signed" in error_msg.lower():
                error_detail = "Self-signed certificate"
            elif "hostname mismatch" in error_msg.lower() or "doesn't match" in error_msg.lower():
                error_detail = "Hostname mismatch"

            # Try to get cert info even with verification failure
            cert_data = self._get_cert_without_verify(hostname, port)

            result_data: dict[str, Any] = {
                "hostname": hostname,
                "port": port,
                "is_valid": False,
                "error": error_detail,
                "error_detail": error_msg,
            }
            if cert_data:
                result_data.update(cert_data)

            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data=result_data,
            )

        except socket.timeout:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Connection timed out after 10s to {hostname}:{port}.",
            )

        except ConnectionRefusedError:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Connection refused on {hostname}:{port}.",
            )

        except socket.gaierror as exc:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"DNS resolution failed for '{hostname}': {exc}",
            )

        except OSError as exc:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Connection failed to {hostname}:{port}: {exc}",
            )

        except Exception as exc:
            logger.warning("network.ssl.check failed hostname=%s port=%d error=%s", hostname, port, exc)
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"SSL check failed: {exc}",
            )

    def _get_cert_without_verify(self, hostname: str, port: int) -> dict[str, Any] | None:
        """Attempt to retrieve certificate details without verification for error reporting."""
        try:
            ctx_noverify = ssl.create_default_context()
            ctx_noverify.check_hostname = False
            ctx_noverify.verify_mode = ssl.CERT_NONE

            with socket.create_connection((hostname, port), timeout=10) as sock:
                with ctx_noverify.wrap_socket(sock, server_hostname=hostname) as ssock:
                    # getpeercert(binary_form=True) works even without verification
                    der_cert = ssock.getpeercert(binary_form=True)
                    if der_cert:
                        # Decode the DER cert to get details
                        pem_cert = ssl.DER_cert_to_PEM_cert(der_cert)
                        # Re-parse using getpeercert with verification disabled
                        cert = ssock.getpeercert()
                        if cert:
                            issuer = _extract_cert_field(cert.get("issuer"))
                            subject = _extract_cert_field(cert.get("subject"))
                            valid_from_str = cert.get("notBefore", "")
                            valid_until_str = cert.get("notAfter", "")
                            serial_number = cert.get("serialNumber", "")

                            valid_from = _parse_cert_time(valid_from_str)
                            valid_until = _parse_cert_time(valid_until_str)

                            now = datetime.now(timezone.utc)
                            days_until_expiry = 0
                            if valid_until:
                                days_until_expiry = compute_days_until_expiry(valid_until, now)

                            return {
                                "issuer": issuer,
                                "subject": subject,
                                "valid_from": valid_from.isoformat() if valid_from else None,
                                "valid_until": valid_until.isoformat() if valid_until else None,
                                "days_until_expiry": days_until_expiry,
                                "serial_number": serial_number,
                            }
        except Exception:
            pass
        return None


# ---------------------------------------------------------------------------
# Wake-on-LAN Draft Tool
# ---------------------------------------------------------------------------

_MAC_PATTERN = re.compile(r"^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$")


class NetworkWolDraftArgs(BaseModel):
    identifier: Optional[str] = Field(
        default=None,
        max_length=200,
        description=(
            "Hostname, inventory number, or network name of the device to wake. "
            "Used to resolve MAC address from ITinvent equipment data."
        ),
    )
    mac_address: Optional[str] = Field(
        default=None,
        pattern=r"^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$",
        description="MAC address in format XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX.",
    )
    broadcast_ip: str = Field(
        default="255.255.255.255",
        description="Broadcast IP address for the WOL magic packet (default 255.255.255.255).",
    )


def _normalize_mac(mac: str) -> str:
    """Normalize MAC address to colon-separated uppercase format."""
    cleaned = mac.upper().replace("-", ":").strip()
    return cleaned


def _build_magic_packet(mac: str) -> bytes:
    """Build a Wake-on-LAN magic packet: 6×0xFF followed by 16×MAC address bytes."""
    # Parse MAC address bytes
    mac_clean = mac.replace(":", "").replace("-", "")
    mac_bytes = bytes.fromhex(mac_clean)
    # Magic packet: 6 bytes of 0xFF + 16 repetitions of the target MAC
    return b"\xff" * 6 + mac_bytes * 16


def _send_wol_packet(mac: str, broadcast_ip: str) -> None:
    """Send a WOL magic packet via UDP broadcast."""
    packet = _build_magic_packet(mac)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (broadcast_ip, 9))
    finally:
        sock.close()


def _resolve_mac_from_itinvent(identifier: str, context: AiToolExecutionContext) -> dict[str, Any] | None:
    """Resolve MAC address and device details from ITinvent equipment data.

    Tries to find equipment by hostname or inventory number and extract MAC address.
    Returns dict with mac_address, hostname, inv_no, employee_name, model_name or None.
    """
    from backend.database import queries

    identifier_stripped = identifier.strip()
    database_id = context.effective_database_id

    # Try resolving by hostname first
    result = queries.resolve_pc_context_by_mac_or_hostname(
        mac_address=None,
        hostname=identifier_stripped,
        db_id=database_id,
    )
    if result and _normalize_text(result.get("mac_address")):
        return {
            "mac_address": _normalize_text(result.get("mac_address")),
            "hostname": _normalize_text(result.get("network_name")),
            "inv_no": _normalize_text(result.get("inv_no")),
            "employee_name": _normalize_text(result.get("employee_name")),
            "model_name": _normalize_text(result.get("model_name")),
            "branch_name": _normalize_text(result.get("branch_name")),
        }

    # Try resolving by inventory number
    equipment = queries.get_equipment_by_inv(identifier_stripped, db_id=database_id)
    if equipment and isinstance(equipment, dict):
        mac_raw = _normalize_text(
            equipment.get("MAC_ADDRESS") or equipment.get("mac_address")
        )
        if mac_raw:
            return {
                "mac_address": mac_raw,
                "hostname": _normalize_text(
                    equipment.get("NETBIOS_NAME") or equipment.get("network_name")
                ),
                "inv_no": _normalize_text(
                    equipment.get("INV_NO") or equipment.get("inv_no")
                ),
                "employee_name": _normalize_text(
                    equipment.get("OWNER_DISPLAY_NAME") or equipment.get("employee_name")
                ),
                "model_name": _normalize_text(
                    equipment.get("MODEL_NAME") or equipment.get("model_name")
                ),
                "branch_name": _normalize_text(
                    equipment.get("BRANCH_NAME") or equipment.get("branch_name")
                ),
            }

    return None


class NetworkWolDraftTool(AiTool):
    tool_id = NETWORK_TOOL_ACTION_WOL_DRAFT
    description = (
        "Create a pending action card to send a Wake-on-LAN magic packet to a device. "
        "Provide either a MAC address directly, or an identifier (hostname, inventory number) "
        "to resolve the MAC from ITinvent equipment data. "
        "Does not send the packet until the user confirms the action card. "
        "Requires admin access."
    )
    input_model = NetworkWolDraftArgs
    admin_only = True
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkWolDraftArgs) -> AiToolResult:
        mac = _normalize_text(args.mac_address)
        identifier = _normalize_text(args.identifier)
        broadcast_ip = _normalize_text(args.broadcast_ip) or "255.255.255.255"
        device_details: dict[str, Any] = {}

        # Resolve MAC address
        if mac and _MAC_PATTERN.match(mac):
            # MAC provided directly
            mac = _normalize_mac(mac)
        elif identifier:
            # Try to resolve MAC from ITinvent
            try:
                resolved = _resolve_mac_from_itinvent(identifier, context)
            except Exception as exc:
                logger.warning("WOL MAC resolution failed identifier=%s error=%s", identifier, exc)
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=(
                        f"Failed to resolve MAC address for '{identifier}': {exc}. "
                        "Please provide the MAC address directly."
                    ),
                )
            if not resolved or not resolved.get("mac_address"):
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=(
                        f"MAC address not found for identifier '{identifier}'. "
                        "Please provide MAC directly using mac_address parameter."
                    ),
                )
            raw_mac = resolved["mac_address"]
            # Normalize the resolved MAC to standard format
            cleaned = raw_mac.upper().replace("-", ":").replace(".", "")
            # If it's a plain hex string without separators, add colons
            if ":" not in cleaned and len(cleaned) == 12:
                cleaned = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))
            mac = cleaned
            device_details = {
                "hostname": resolved.get("hostname") or None,
                "inv_no": resolved.get("inv_no") or None,
                "employee_name": resolved.get("employee_name") or None,
                "model_name": resolved.get("model_name") or None,
                "branch_name": resolved.get("branch_name") or None,
            }
        else:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Either mac_address or identifier (hostname/inventory number) must be provided.",
            )

        # Validate final MAC format
        if not _MAC_PATTERN.match(mac):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Invalid MAC address format: '{mac}'. Expected XX:XX:XX:XX:XX:XX.",
            )

        # Build the draft/confirmation card
        payload = {
            "mac_address": mac,
            "broadcast_ip": broadcast_ip,
            "identifier": identifier or None,
            **{k: v for k, v in device_details.items() if v},
        }

        try:
            from backend.ai_chat.action_cards import create_pending_action

            card = create_pending_action(
                action_type="network.wol",
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=context.effective_database_id,
                payload=payload,
                preview={
                    "title": "Wake-on-LAN",
                    "description": f"Отправить WOL magic packet на устройство",
                    "mac_address": mac,
                    "broadcast_ip": broadcast_ip,
                    **{k: v for k, v in device_details.items() if v},
                },
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={"action_card": card, "requires_confirmation": True},
            )
        except Exception as exc:
            logger.warning("WOL draft creation failed mac=%s error=%s", mac, exc)
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Failed to create WOL action card: {exc}",
            )


# ---------------------------------------------------------------------------
# WMI Host Info Tool
# ---------------------------------------------------------------------------


class NetworkHostInfoArgs(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=253)


def _build_wmi_script(hostname: str) -> str:
    """Build PowerShell script to query remote host info via WMI."""
    # Escape single quotes in hostname to prevent injection
    safe_hostname = hostname.replace("'", "''")
    return (
        "$ErrorActionPreference = 'Stop';\n"
        f"$h = '{safe_hostname}';\n"
        "try {\n"
        "  $os = Get-WmiObject Win32_OperatingSystem -ComputerName $h;\n"
        "  $cpu = Get-WmiObject Win32_Processor -ComputerName $h;\n"
        "  $disks = Get-WmiObject Win32_LogicalDisk -Filter \"DriveType=3\" -ComputerName $h;\n"
        "  $boot = $os.ConvertToDateTime($os.LastBootUpTime);\n"
        "  $uptime = [math]::Round(((Get-Date) - $boot).TotalHours, 1);\n"
        "  $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2);\n"
        "  $ramFree = [math]::Round($os.FreePhysicalMemory / 1MB, 2);\n"
        "  $ramUsed = [math]::Round($ramTotal - $ramFree, 2);\n"
        "  $cpuLoad = ($cpu | Measure-Object -Property LoadPercentage -Average).Average;\n"
        "  $diskList = @();\n"
        "  foreach ($d in $disks) {\n"
        "    $totalGb = [math]::Round($d.Size / 1GB, 2);\n"
        "    $freeGb = [math]::Round($d.FreeSpace / 1GB, 2);\n"
        "    $pctUsed = if ($d.Size -gt 0) { [math]::Round((($d.Size - $d.FreeSpace) / $d.Size) * 100, 1) } else { 0 };\n"
        "    $diskList += @{ drive_letter = $d.DeviceID; total_gb = $totalGb; free_gb = $freeGb; percent_used = $pctUsed };\n"
        "  }\n"
        "  $result = @{\n"
        "    hostname = $h;\n"
        "    os_version = $os.Caption;\n"
        "    uptime_hours = $uptime;\n"
        "    cpu_usage_percent = [math]::Round($cpuLoad, 1);\n"
        "    ram_total_gb = $ramTotal;\n"
        "    ram_used_gb = $ramUsed;\n"
        "    disks = $diskList;\n"
        "  };\n"
        "  $result | ConvertTo-Json -Depth 3;\n"
        "} catch {\n"
        "  Write-Error $_.Exception.Message;\n"
        "  exit 1;\n"
        "}"
    )


def _parse_wmi_output(output: str) -> dict[str, Any] | None:
    """Parse JSON output from the WMI PowerShell script."""
    import json

    text = output.strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None

    # Normalize the result structure
    result: dict[str, Any] = {
        "hostname": _normalize_text(data.get("hostname")),
        "os_version": _normalize_text(data.get("os_version")),
        "uptime_hours": None,
        "cpu_usage_percent": None,
        "ram_total_gb": None,
        "ram_used_gb": None,
        "disks": [],
    }

    # Parse numeric fields safely
    try:
        result["uptime_hours"] = round(float(data.get("uptime_hours", 0)), 1)
    except (TypeError, ValueError):
        pass

    try:
        result["cpu_usage_percent"] = round(float(data.get("cpu_usage_percent", 0)), 1)
    except (TypeError, ValueError):
        pass

    try:
        result["ram_total_gb"] = round(float(data.get("ram_total_gb", 0)), 2)
    except (TypeError, ValueError):
        pass

    try:
        result["ram_used_gb"] = round(float(data.get("ram_used_gb", 0)), 2)
    except (TypeError, ValueError):
        pass

    # Parse disks list
    raw_disks = data.get("disks")
    if isinstance(raw_disks, list):
        for disk in raw_disks:
            if not isinstance(disk, dict):
                continue
            try:
                result["disks"].append({
                    "drive_letter": _normalize_text(disk.get("drive_letter")),
                    "total_gb": round(float(disk.get("total_gb", 0)), 2),
                    "free_gb": round(float(disk.get("free_gb", 0)), 2),
                    "percent_used": round(float(disk.get("percent_used", 0)), 1),
                })
            except (TypeError, ValueError):
                continue
    elif isinstance(raw_disks, dict):
        # Single disk returned as object instead of array by PowerShell
        try:
            result["disks"].append({
                "drive_letter": _normalize_text(raw_disks.get("drive_letter")),
                "total_gb": round(float(raw_disks.get("total_gb", 0)), 2),
                "free_gb": round(float(raw_disks.get("free_gb", 0)), 2),
                "percent_used": round(float(raw_disks.get("percent_used", 0)), 1),
            })
        except (TypeError, ValueError):
            pass

    return result


class NetworkHostInfoTool(AiTool):
    tool_id = NETWORK_TOOL_HOST_INFO
    description = (
        "Get remote Windows host information via WMI: OS version, uptime, CPU usage, "
        "RAM usage, and disk space. Requires admin access. "
        "Provide the hostname or IP address of the target Windows machine."
    )
    input_model = NetworkHostInfoArgs
    admin_only = True
    stage = "checking_network"

    def execute(self, *, context: AiToolExecutionContext, args: NetworkHostInfoArgs) -> AiToolResult:
        hostname = args.hostname.strip()
        script = _build_wmi_script(hostname)

        try:
            proc = subprocess.run(
                ["powershell", "-Command", script],
                timeout=10,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Command timed out after 10s. Host '{hostname}' may be unreachable.",
            )
        except FileNotFoundError:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="PowerShell is not available on this system.",
            )
        except Exception as exc:
            logger.warning("network.host.info failed hostname=%s error=%s", hostname, exc)
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"WMI query execution failed: {exc}",
            )

        # Check for errors
        stderr = (proc.stderr or "").strip()
        if proc.returncode != 0:
            # Detect common error patterns
            error_lower = stderr.lower()
            if "access denied" in error_lower or "access is denied" in error_lower:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"WMI access denied on host '{hostname}'. Check permissions.",
                )
            if "rpc server" in error_lower or "unavailable" in error_lower:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"Host '{hostname}' is unreachable (RPC server unavailable).",
                )
            if "not found" in error_lower or "cannot find" in error_lower:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error=f"Host '{hostname}' not found. Check hostname or DNS.",
                )
            # Generic error
            error_msg = stderr[:300] if stderr else "Unknown error (non-zero exit code)"
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"WMI query failed on '{hostname}': {error_msg}",
            )

        # Parse the JSON output
        stdout = (proc.stdout or "").strip()
        parsed = _parse_wmi_output(stdout)
        if parsed is None:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Failed to parse WMI output from host '{hostname}'.",
            )

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data=parsed,
        )


for _tool in [
    NetworkSocketSearchTool(),
    NetworkBranchOverviewTool(),
    NetworkPortsSearchTool(),
    NetworkHostPingTool(),
    NetworkDnsLookupTool(),
    NetworkSslCheckTool(),
    NetworkWolDraftTool(),
    NetworkHostInfoTool(),
]:
    ai_tool_registry.register(_tool)
