"""Unit tests for NetworkDnsLookupTool — registration, input validation, and DNS resolution."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.ai_chat.tools.network import (
    NetworkDnsLookupArgs,
    NetworkDnsLookupTool,
    _dns_lookup_nslookup,
)
from backend.ai_chat.tools.registry import ai_tool_registry


# ---------------------------------------------------------------------------
# Registration & attributes
# ---------------------------------------------------------------------------


def test_dns_tool_registered():
    """network.dns.lookup is registered in the global tool registry."""
    tool = ai_tool_registry.get("network.dns.lookup")
    assert tool is not None
    assert tool.tool_id == "network.dns.lookup"


def test_dns_tool_not_admin_only():
    """DNS lookup tool does not require admin access."""
    tool = NetworkDnsLookupTool()
    assert tool.admin_only is False


def test_dns_tool_stage():
    """DNS lookup tool uses the checking_network stage."""
    tool = NetworkDnsLookupTool()
    assert tool.stage == "checking_network"


def test_dns_tool_description():
    """DNS lookup tool has a meaningful description."""
    tool = NetworkDnsLookupTool()
    assert "DNS" in tool.description
    assert tool.description


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_dns_args_defaults():
    """Default record_type is 'A'."""
    args = NetworkDnsLookupArgs(query="example.com")
    assert args.record_type == "A"
    assert args.query == "example.com"


@pytest.mark.parametrize("record_type", ["A", "AAAA", "MX", "CNAME", "PTR", "TXT", "NS"])
def test_dns_args_valid_record_types(record_type: str):
    """All valid record types are accepted."""
    args = NetworkDnsLookupArgs(query="example.com", record_type=record_type)
    assert args.record_type == record_type


def test_dns_args_invalid_record_type():
    """Invalid record_type is rejected by Pydantic validation."""
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="example.com", record_type="INVALID")


def test_dns_args_invalid_record_type_srv():
    """SRV is not in the allowed set."""
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="example.com", record_type="SRV")


def test_dns_args_empty_query():
    """Empty query is rejected."""
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="", record_type="A")


def test_dns_args_query_too_long():
    """Query exceeding 253 chars is rejected."""
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="x" * 254, record_type="A")


def test_dns_args_query_max_length():
    """Query at exactly 253 chars is accepted."""
    args = NetworkDnsLookupArgs(query="x" * 253, record_type="A")
    assert len(args.query) == 253


def test_dns_args_record_type_case_sensitive():
    """record_type pattern is case-sensitive — lowercase rejected."""
    with pytest.raises(ValidationError):
        NetworkDnsLookupArgs(query="example.com", record_type="a")
