"""Unit tests for new network tools — registration, admin_only, input validation, and WOL magic packet.

Tests cover:
- Tool registration for all new network tool IDs
- admin_only attribute correctness (wol_draft=True, host_info=True, others=False)
- Input validation ranges (count 1–10, port 1–65535, record_type enum)
- WOL magic packet construction (_build_magic_packet)

Requirements: 5.5, 6.2, 7.5, 12.4, 13.5
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.ai_chat.tools.network import (
    NetworkHostPingArgs,
    NetworkHostPingTool,
    NetworkDnsLookupArgs,
    NetworkDnsLookupTool,
    NetworkSslCheckArgs,
    NetworkSslCheckTool,
    NetworkWolDraftArgs,
    NetworkWolDraftTool,
    NetworkHostInfoArgs,
    NetworkHostInfoTool,
    _build_magic_packet,
)
from backend.ai_chat.tools.registry import ai_tool_registry


# ---------------------------------------------------------------------------
# Tool Registration
# ---------------------------------------------------------------------------


class TestToolRegistration:
    """Verify all new network tools are registered in the global registry."""

    def test_ping_tool_registered(self):
        tool = ai_tool_registry.get("network.host.ping")
        assert tool is not None
        assert tool.tool_id == "network.host.ping"

    def test_dns_tool_registered(self):
        tool = ai_tool_registry.get("network.dns.lookup")
        assert tool is not None
        assert tool.tool_id == "network.dns.lookup"

    def test_ssl_tool_registered(self):
        tool = ai_tool_registry.get("network.ssl.check")
        assert tool is not None
        assert tool.tool_id == "network.ssl.check"

    def test_wol_tool_registered(self):
        tool = ai_tool_registry.get("network.action.wol_draft")
        assert tool is not None
        assert tool.tool_id == "network.action.wol_draft"

    def test_host_info_tool_registered(self):
        tool = ai_tool_registry.get("network.host.info")
        assert tool is not None
        assert tool.tool_id == "network.host.info"


# ---------------------------------------------------------------------------
# admin_only Attribute
# ---------------------------------------------------------------------------


class TestAdminOnlyAttribute:
    """Verify admin_only is True for wol_draft and host_info, False for others."""

    def test_ping_not_admin_only(self):
        tool = NetworkHostPingTool()
        assert tool.admin_only is False

    def test_dns_not_admin_only(self):
        tool = NetworkDnsLookupTool()
        assert tool.admin_only is False

    def test_ssl_not_admin_only(self):
        tool = NetworkSslCheckTool()
        assert tool.admin_only is False

    def test_wol_admin_only(self):
        tool = NetworkWolDraftTool()
        assert tool.admin_only is True

    def test_host_info_admin_only(self):
        tool = NetworkHostInfoTool()
        assert tool.admin_only is True


# ---------------------------------------------------------------------------
# Input Validation — Ping (count 1–10)
# ---------------------------------------------------------------------------


class TestPingInputValidation:
    """Validate NetworkHostPingArgs count range 1–10."""

    def test_count_default(self):
        args = NetworkHostPingArgs(host="example.com")
        assert args.count == 4

    def test_count_min_valid(self):
        args = NetworkHostPingArgs(host="example.com", count=1)
        assert args.count == 1

    def test_count_max_valid(self):
        args = NetworkHostPingArgs(host="example.com", count=10)
        assert args.count == 10

    def test_count_below_min_rejected(self):
        with pytest.raises(ValidationError):
            NetworkHostPingArgs(host="example.com", count=0)

    def test_count_above_max_rejected(self):
        with pytest.raises(ValidationError):
            NetworkHostPingArgs(host="example.com", count=11)

    def test_count_negative_rejected(self):
        with pytest.raises(ValidationError):
            NetworkHostPingArgs(host="example.com", count=-1)


# ---------------------------------------------------------------------------
# Input Validation — SSL (port 1–65535)
# ---------------------------------------------------------------------------


class TestSslInputValidation:
    """Validate NetworkSslCheckArgs port range 1–65535."""

    def test_port_default(self):
        args = NetworkSslCheckArgs(hostname="example.com")
        assert args.port == 443

    def test_port_min_valid(self):
        args = NetworkSslCheckArgs(hostname="example.com", port=1)
        assert args.port == 1

    def test_port_max_valid(self):
        args = NetworkSslCheckArgs(hostname="example.com", port=65535)
        assert args.port == 65535

    def test_port_zero_rejected(self):
        with pytest.raises(ValidationError):
            NetworkSslCheckArgs(hostname="example.com", port=0)

    def test_port_above_max_rejected(self):
        with pytest.raises(ValidationError):
            NetworkSslCheckArgs(hostname="example.com", port=65536)

    def test_port_negative_rejected(self):
        with pytest.raises(ValidationError):
            NetworkSslCheckArgs(hostname="example.com", port=-1)

    def test_hostname_empty_rejected(self):
        with pytest.raises(ValidationError):
            NetworkSslCheckArgs(hostname="")

    def test_hostname_too_long_rejected(self):
        with pytest.raises(ValidationError):
            NetworkSslCheckArgs(hostname="a" * 254)


# ---------------------------------------------------------------------------
# Input Validation — DNS (record_type enum)
# ---------------------------------------------------------------------------


class TestDnsInputValidation:
    """Validate NetworkDnsLookupArgs record_type enum."""

    @pytest.mark.parametrize("record_type", ["A", "AAAA", "MX", "CNAME", "PTR", "TXT", "NS"])
    def test_valid_record_types_accepted(self, record_type: str):
        args = NetworkDnsLookupArgs(query="example.com", record_type=record_type)
        assert args.record_type == record_type

    def test_default_record_type_is_a(self):
        args = NetworkDnsLookupArgs(query="example.com")
        assert args.record_type == "A"

    @pytest.mark.parametrize("invalid_type", ["INVALID", "SRV", "SOA", "ANY", "a", "mx", ""])
    def test_invalid_record_types_rejected(self, invalid_type: str):
        with pytest.raises(ValidationError):
            NetworkDnsLookupArgs(query="example.com", record_type=invalid_type)

    def test_query_empty_rejected(self):
        with pytest.raises(ValidationError):
            NetworkDnsLookupArgs(query="")

    def test_query_too_long_rejected(self):
        with pytest.raises(ValidationError):
            NetworkDnsLookupArgs(query="x" * 254)


# ---------------------------------------------------------------------------
# Input Validation — WOL
# ---------------------------------------------------------------------------


class TestWolInputValidation:
    """Validate NetworkWolDraftArgs MAC pattern and fields."""

    def test_valid_mac_colon_separated(self):
        args = NetworkWolDraftArgs(mac_address="AA:BB:CC:DD:EE:FF")
        assert args.mac_address == "AA:BB:CC:DD:EE:FF"

    def test_valid_mac_dash_separated(self):
        args = NetworkWolDraftArgs(mac_address="AA-BB-CC-DD-EE-FF")
        assert args.mac_address == "AA-BB-CC-DD-EE-FF"

    def test_valid_mac_lowercase(self):
        args = NetworkWolDraftArgs(mac_address="aa:bb:cc:dd:ee:ff")
        assert args.mac_address == "aa:bb:cc:dd:ee:ff"

    def test_invalid_mac_rejected(self):
        with pytest.raises(ValidationError):
            NetworkWolDraftArgs(mac_address="INVALID_MAC")

    def test_invalid_mac_short_rejected(self):
        with pytest.raises(ValidationError):
            NetworkWolDraftArgs(mac_address="AA:BB:CC")

    def test_default_broadcast_ip(self):
        args = NetworkWolDraftArgs(identifier="my-pc")
        assert args.broadcast_ip == "255.255.255.255"

    def test_both_none_accepted_at_model_level(self):
        """Both identifier and mac_address can be None at Pydantic level (tool logic validates)."""
        args = NetworkWolDraftArgs()
        assert args.identifier is None
        assert args.mac_address is None


# ---------------------------------------------------------------------------
# Input Validation — Host Info
# ---------------------------------------------------------------------------


class TestHostInfoInputValidation:
    """Validate NetworkHostInfoArgs hostname constraints."""

    def test_valid_hostname(self):
        args = NetworkHostInfoArgs(hostname="server01.corp.local")
        assert args.hostname == "server01.corp.local"

    def test_hostname_empty_rejected(self):
        with pytest.raises(ValidationError):
            NetworkHostInfoArgs(hostname="")

    def test_hostname_too_long_rejected(self):
        with pytest.raises(ValidationError):
            NetworkHostInfoArgs(hostname="h" * 254)

    def test_hostname_max_length_accepted(self):
        args = NetworkHostInfoArgs(hostname="h" * 253)
        assert len(args.hostname) == 253


# ---------------------------------------------------------------------------
# WOL Magic Packet Construction
# ---------------------------------------------------------------------------


class TestBuildMagicPacket:
    """Verify _build_magic_packet produces correct WOL magic packet structure."""

    def test_packet_length_is_102_bytes(self):
        """Magic packet must be exactly 102 bytes: 6×0xFF + 16×6 MAC bytes."""
        packet = _build_magic_packet("AA:BB:CC:DD:EE:FF")
        assert len(packet) == 102

    def test_packet_starts_with_6_ff_bytes(self):
        """First 6 bytes must all be 0xFF."""
        packet = _build_magic_packet("AA:BB:CC:DD:EE:FF")
        assert packet[:6] == b"\xff\xff\xff\xff\xff\xff"

    def test_packet_contains_16_mac_repetitions(self):
        """After the 6×0xFF header, the MAC is repeated 16 times."""
        mac = "AA:BB:CC:DD:EE:FF"
        packet = _build_magic_packet(mac)
        mac_bytes = bytes.fromhex("AABBCCDDEEFF")
        payload = packet[6:]
        assert len(payload) == 96  # 16 × 6 bytes
        for i in range(16):
            assert payload[i * 6 : (i + 1) * 6] == mac_bytes

    def test_packet_with_dash_separated_mac(self):
        """Dash-separated MAC produces the same correct packet."""
        packet = _build_magic_packet("11-22-33-44-55-66")
        assert len(packet) == 102
        mac_bytes = bytes.fromhex("112233445566")
        assert packet[:6] == b"\xff" * 6
        assert packet[6:12] == mac_bytes

    def test_packet_with_lowercase_mac(self):
        """Lowercase MAC is handled correctly."""
        packet = _build_magic_packet("ab:cd:ef:01:23:45")
        assert len(packet) == 102
        mac_bytes = bytes.fromhex("abcdef012345")
        assert packet[6:12] == mac_bytes
        # Verify all 16 repetitions
        for i in range(16):
            assert packet[6 + i * 6 : 6 + (i + 1) * 6] == mac_bytes

    def test_packet_all_zeros_mac(self):
        """All-zeros MAC produces valid packet structure."""
        packet = _build_magic_packet("00:00:00:00:00:00")
        assert len(packet) == 102
        assert packet[:6] == b"\xff" * 6
        assert packet[6:] == b"\x00" * 96

    def test_packet_all_ff_mac(self):
        """All-FF MAC produces valid packet (all bytes are 0xFF)."""
        packet = _build_magic_packet("FF:FF:FF:FF:FF:FF")
        assert len(packet) == 102
        # Entire packet is 0xFF
        assert packet == b"\xff" * 102
